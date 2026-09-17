# pi-session-handoff

把当前会话交接给一个新会话：由当前 Agent 写一份交接文档，然后新会话自动接着干。

这是「交接替代压缩」的做法——不压缩上下文，而是在你主动触发的时机把完整上下文总结成交接文件，再开一个干净的会话继续。

## 它做什么

`/handoff` 一条命令完成四件事：

1. 让当前 Agent 把上下文（目标、进展、决策、后续任务、会话链、关键文件）写成一份交接文档。
2. 扩展生成文档头（会话链、来源会话路径、cwd、时间戳）并把文档写到会话目录旁的 `handoffs/`。
3. 用 `ctx.newSession({ parentSession })` 开一个新会话，旧会话完整保留在磁盘上。
4. 把交接文档全文注入新会话作为第一条消息，并自动发出继续指令——不需要你再说一遍。

## 安装

从 npm 安装（在 `.pi/settings.json` 的 `packages` 里加一条）：

```json
{
  "packages": ["npm:@sycghj/pi-session-handoff"]
}
```

本地开发时直接指向源码目录：

```json
{
  "packages": ["F:/code/pi/pi-session-handoff"]
}
```

## 用法

```text
/handoff
/handoff 重点交接测试策略和迁移路径
```

参数是可选的，用来告诉 Agent 这份交接该偏重什么；不传就按整体交接。

`/handoff` 会先等当前回合跑完再开始，所以流式输出中途触发也没关系。

## 自动触发

上下文用量达到阈值（默认 80%）时，扩展会自动排队一次 `/handoff`。交接在当前回合结束后才开始，不会打断流式输出。

阈值早于 Pi 自己的自动压缩（约 92%），所以交接总是先于压缩发生——两者不会打架。如果你希望完全禁止自动压缩，可以在 Pi 设置里把 `compaction.enabled` 设为 `false`。

配置方式：环境变量 `PI_HANDOFF_AUTO_PERCENT`，取值 1–100 的整数，或 `off` 关闭自动触发。

```bash
# 90% 才触发
PI_HANDOFF_AUTO_PERCENT=90 pi

# 关闭自动触发
PI_HANDOFF_AUTO_PERCENT=off pi
```

每次跨阈值只触发一次；交接完成后（新会话从接近 0% 开始）自动复位。

## 模型主动调用

扩展注册了一个 `handoff` 工具，模型可以在合适的时候自己调用——比如上下文快满了，或者工作即将跨过一个大的阶段边界。工具不直接执行交接，而是排队 `/handoff` 命令，由命令处理器在当前回合结束后执行。

## 交接文档

位置：`~/.pi/agent/sessions/--<cwd>--/handoffs/<timestamp>_<sessionId>.md`。

文件名沿用 Pi 自己的会话文件命名方式，所以交接文档会和它描述的那个会话排在一起，既不会污染项目目录，也和它引用的会话链同处一地。

文档头由扩展生成，因此会话链和来源会话路径永远是准确的：

| 字段 | 含义 |
| --- | --- |
| `handoff` | 恒为 `true` |
| `created` | 交接时间（ISO 8601） |
| `from_session` | 来源会话文件绝对路径 |
| `from_session_id` | 来源会话 id |
| `cwd` | 来源会话的工作目录 |
| `parent_sessions` | 前序会话文件列表，由近到远 |
| `focus` | 仅在你传了参数时出现 |

正文由 Agent 写，固定章节：`Goal & background`、`Current state`、`Decisions & rationale`、`Next tasks`、`Session chain`、`Key files & commands`。

正文章节名固定为英文，正文语言跟随对话本身。

## 为什么不让 Agent 自己写文件

扩展只让 Agent 回复正文，落盘由扩展自己做，原因有两个：

- Agent 用 `write` 工具写工作目录之外的文件会撞上 `external_directory` 权限闸（默认 `ask`），每交接一次就要批一次。
- 路径和文档头交给扩展生成，不会有模型写错路径或漏写会话链的情况。

## 失败时的行为

交接失败不会让你丢掉当前会话——所有检查都在开新会话之前完成：

| 情况 | 行为 |
| --- | --- |
| 会话未持久化（没有会话文件） | 报错，留在原会话 |
| 回合被中断（Esc） | 报取消，留在原会话 |
| Agent 没有输出正文 | 报错，留在原会话 |
| 正文过短或不含标题 | 报错，留在原会话 |
| 写文件失败 | 报错，留在原会话 |
| 新会话被其他扩展取消 | 报取消，交接文档保留在磁盘 |
| 新会话建立但自动继续失败 | 提示错误；文档已注入，你可以直接输入继续 |

## 前置条件

- 当前会话必须已持久化（有会话文件）；纯内存会话无法交接。
- 需要有可用模型，交接回合要真的跑一次。

## 开发

```bash
pnpm install
pnpm run check   # tsc --noEmit
pnpm test        # vitest run
```

## 设计要点

给未来的维护者留几条关键决定：

- 生成与替换是两个独立步骤（`src/handoff/flow.ts` 里先后调用），所以「接近上下文上限时自动触发」只是再加一个触发点，核心不用改。
- 自动触发（`src/handoff/trigger.ts`）在 `agent_settled` 时检查 `ctx.getContextUsage()`，超过阈值就排队 `/handoff` 作为 follow-up。触发后进入冷却，直到用量回落（新会话开始）才重新武装——避免交接失败后反复触发。
- `handoff` 工具（`src/handoff/tool.ts`）让模型可以主动调用交接。工具本身不执行交接，只排队 `/handoff` 命令，由命令处理器在回合结束后执行。
- 完成信号用 `agent_settled` 事件而不是 `ctx.waitForIdle()`：`pi.sendUserMessage()` 是发射后不管的（返回 `void`），run 启动前 `waitForIdle()` 会直接返回，存在竞态；`agent_settled` 在 run（含重试与自动压缩续跑）彻底结束后才触发。
- 会话替换后旧 `ctx` 即失效，所以替换之后的所有 UI 动作都走 `withSession` 拿到的替换上下文。
- 文档正文的校验只做「足够长 + 含 markdown 标题」这类结构性检查，不猜模型措辞。

## License

MIT
