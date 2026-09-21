# 兮爷的小小博物馆

一个默认私密、以沉浸式 2D 画廊为核心的儿童个人线上博物馆。当前版本包含示范展览、移动端作品录入、图片/音频隐私清理、AI 馆长审核流，以及 Supabase 数据与权限迁移。

## 当前策展能力

- **多展览后台**：支持展览列表、新建、选择编辑、草稿/已发布/已归档状态，以及“最新 published 作为首页默认展厅”的选择规则。
- **展厅展示配置**：每个展室内的作品都可单独保存 `display_config`，包括 `featured`、`size`（`small` / `medium` / `large`）和 `framePreset`（`classic` / `shadow` / `float` / `storybook`）。
- **AI 策展文案审核流**：基于作品标题、作品介绍与孩子原话生成展览标题、门厅序言和展室串词；所有建议都会先持久化为待审核记录，编辑后旧建议会自动变 stale。
- **预览与发布**：馆长可在后台内切换桌面 / 手机容器预览草稿；发布前会校验“至少 2 个展室，且每个展室至少 1 件已发布作品”。
- **沉浸式与简洁模式**：访客可见的“简洁模式”会切换到目录 / 静态网格；普通模式支持键盘、触摸与桌面滚轮横向换展室。
- **私密录音播放**：展厅详情弹窗会在可访问会话内加载短时签名 `audioUrl`，无录音时明确提示等待补录。
- **完整私密备份**：馆长可导出真正可恢复的 ZIP 备份，包含版本化 JSON 与全部已登记私密媒体；所有表都会按 `<=500` 的稳定唯一顺序分页读到耗尽，备份绝不含 token hash、session hash、签名 URL，`artwork_tags` 会完整保留真实标签对象。
- **全馆永久删除**：馆长需输入博物馆名或固定短语再次确认；数据库原子删除整馆数据，仅保留登录账号，并把 Storage 删除纳入可重试 `media_cleanup_jobs`。
- **大文件直传链路**：浏览器只上传重新编码后的 WebP 与音频到私有 `museum-private/temp` 临时路径；授权会持久化 `media_upload_sessions`，服务端只允许以 service role 校验后切换到正式版本化路径，失败或过期会进入受控清理队列。

## 本地资源环境（Windows PowerShell）

### 前置条件

- Node.js 与 `npm.cmd`
- **Docker Desktop（必须安装、启动并使用 Linux containers）**

> 当前开发环境已在 Docker Desktop Linux containers 下完成 Supabase、本地应用和 AI mock 部署。若换到新机器，首次启动仍需重新执行下方 bootstrap。

首次启动：

```powershell
Set-Location C:\Users\zhaojian\Downloads\GH_Projects\ai_ideas\kids-museum
npm.cmd install
npm.cmd run local:bootstrap
```

`local:bootstrap` 会检查 Docker、启动 Supabase、以 `supabase status -o env` 读取本地密钥、创建被 Git 忽略的 `.env.local`，再通过**仅限回环地址**的 Admin API 创建固定本地馆长与虚构占位数据。它不会把密钥写入受版本控制的文件。已有的本地 `.env.local` 只刷新 Supabase 行并保留其他设置；若文件指向云端则拒绝覆盖。确需完整改为本地值时运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\bootstrap-local.ps1 -Force
```

应用既可以直接由 Node.js 运行，也可以与本地 AI mock 一起放入 Docker。推荐容器方式：

```powershell
npm.cmd run docker:up
npm.cmd run docker:preview
```

浏览器访问 `http://localhost:3000`。应用容器通过
`host.docker.internal:54321` 访问 Supabase，而浏览器仍通过
`127.0.0.1:54321` 访问公开 API；两类地址已明确分离。

如需不登录直接查看示范展览和馆长台，运行 `npm.cmd run docker:preview`，
访问 `http://127.0.0.1:3100`。该服务强制使用演示数据，不读取真实私密馆藏。

查看日志或停止应用容器：

```powershell
npm.cmd run docker:logs
npm.cmd run docker:down
```

如果需要直接由 Node.js 运行，则分别打开两个 PowerShell 窗口：

```powershell
# 窗口 1：仅监听 127.0.0.1:4010 的确定性 OpenAI 兼容模拟服务
npm.cmd run ai:mock

# 窗口 2：Web 应用
npm.cmd run dev
```

### 本地服务

| 服务 | URL |
| --- | --- |
| Web 应用 | `http://localhost:3000` |
| Supabase API | `http://127.0.0.1:54321` |
| PostgreSQL | `127.0.0.1:54322` |
| Supabase Studio | `http://127.0.0.1:54323` |
| Mailpit | `http://127.0.0.1:54324` |
| 本地 AI mock 健康检查 | `http://127.0.0.1:4010/health` |

其他连接信息可用 `npm.cmd run supabase:status` 查看；不要把其中的 key 复制到 README、`.env.example` 或提交记录。

### 本地登录与邮件

配置允许邮箱注册，且本地邮箱确认关闭。bootstrap 创建的固定测试账号为：

- 邮箱：`curator@kids-museum.local`
- 密码：`MuseumLocal123!`（仅用于本机回环环境）

应用使用 magic link：打开 `http://localhost:3000/login`，输入上述邮箱，在 Mailpit 打开邮件并点击链接；回调地址为 `http://localhost:3000/auth/callback`。也可输入新的虚构本地邮箱测试注册/登录，邮件不会发送到互联网。

### 迁移、重置与停止

```powershell
# 查看本地状态
npm.cmd run supabase:status

# 新建迁移；不要手改已经应用的迁移
npm.cmd exec -- supabase migration new <migration_name>

# 重放现有迁移和 supabase\seed.sql，再恢复固定本地账号/占位数据
npm.cmd run supabase:reset

# 只重置数据库（不运行 Admin API 资源脚本）
npm.cmd run supabase:db:reset

# db:reset 后可单独恢复本地资源；脚本会读取 supabase status -o env
npm.cmd run supabase:setup

# 停止容器
npm.cmd run supabase:stop
```

`supabase\seed.sql` 刻意不直接写 `auth.*` 内部表，避免 GoTrue 版本变化导致 reset 失败；`tools\setup-local-resources.mjs` 仅接受 `localhost`/`127.0.0.1`/`::1` 的 54321 端口，并使用本地 Admin API 幂等创建数据。占位记录不含真实儿童图片、身份或秘密。

### 本地 AI mock

mock 使用 Node 内置模块，不访问网络、不分析或保存图片，并返回固定、合法的 `chat/completions` JSON。直接验证：

```powershell
Invoke-RestMethod http://127.0.0.1:4010/health

$body = @{
  model = "kids-museum-local-mock"
  messages = @(@{ role = "user"; content = "test" })
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:4010/v1/chat/completions `
  -ContentType "application/json" `
  -Body $body
```

## 提交前验证

先确保 Supabase、AI mock 和应用均可启动，并完成一次 Mailpit 登录及 AI 建议，再运行：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:unit
npm.cmd run test:integration   # 无 Docker 时会明确 skip
npm.cmd run e2e:preview
npm.cmd run e2e:supabase      # 无 Docker 时会明确 skip
npm.cmd run build
npm.cmd run verify            # 总入口，按上述顺序执行
```

## 通过本地检查后再推广到云端

### Supabase

1. 在目标 Supabase 项目确认 PostgreSQL 主版本与 `supabase\config.toml` 一致。
2. 登录、关联项目，先预览再推送迁移：

```powershell
npm.cmd exec -- supabase login
npm.cmd exec -- supabase link --project-ref <project-ref>
npm.cmd exec -- supabase db push --dry-run
npm.cmd exec -- supabase db push
```

不要把本地占位账号、`.env.local` 或 service-role key 提交/导入生产。云端 Auth 的站点 URL、回调 URL、邮件确认和 SMTP 策略需在 Supabase Dashboard 按生产域名单独设置。

### Vercel

在 Vercel 中分别添加生产项目 URL、anon/publishable key、仅服务端使用的 service-role key，以及真实 OpenAI 兼容服务配置；按提示输入值，不要把值放在命令、脚本或 Git 中：

```powershell
npx.cmd vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx.cmd vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
npx.cmd vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx.cmd vercel env add OPENAI_API_KEY production
npx.cmd vercel env add OPENAI_BASE_URL production
npx.cmd vercel env add OPENAI_VISION_MODEL production
npx.cmd vercel env add OPENAI_TRANSCRIPTION_MODEL production
npm.cmd run preflight:deploy
npx.cmd vercel --prod
```

所有作品媒体都存入私有 `museum-private` bucket。存储路径第一段必须是博物馆 UUID，行级安全会据此校验馆长身份。
Vercel Serverless / Edge 请求体不适合承载多张 base64 原图（实测会撞上约 4.5 MB 请求体限制）；云端模式必须走“授权签名直传 → 服务端 commit 验证 → DB/RPC 原子切换”的链路，请不要回退成把 data URL 发到 API。
部署前若本地曾出现 Storage 清理失败，可运行 `npm.cmd run cleanup:media` 让 service-role 以每批最多 1000 个对象重试队列中的 `media_cleanup_jobs`。

本仓库当前已包含 `0001`–`0017` 迁移；`0009`–`0017` 负责私密备份/清理队列、安全授权直传、上传会话持久化、仅 service-role 可执行的作品资产切换事务、API 角色授权，以及 Storage policy 列限定修复。不要修改已经在共享环境应用过的迁移；后续变更必须追加新迁移。

## 隐私边界

- 新作品默认保存为草稿。
- 浏览器重新编码图片，移除原照片中的 EXIF/GPS 元数据，只直传私密 original / display / thumbnail 三份 WebP；原始未清理照片不会离开本机。
- 录音仅接受受限 MIME、大小与时长，并直传到私密 bucket 的临时路径后再由服务端 commit。
- 服务端会重新解析并验证真实音频时长；无法可靠验证的格式会被拒绝，超过 600 秒会失败。
- 服务端 commit 会重新下载临时对象，校验真实图片头 / 像素 / 音频时长，再切换到新的版本化正式路径；数据库仅接受真实存在于 `storage.objects`、路径/文件名/MIME 全部匹配的正式对象；旧路径、临时路径与失败残留都会进入可观察的 cleanup job。
- 浏览器侧上传中断时只会上报 upload session，服务端会按数据库记录的临时路径清理；不会接受客户端任意传入待删路径。
- 展厅播放录音仅使用短时签名 URL，bucket 仍保持私有。
- 家长备注不会发送给 AI。
- 作品级 AI 建议、录音转写与展览级 AI 策展建议都会持久化为待审核记录；只有逐项采纳后才会写回作品或展览文案。
- 数据库不保存邀请明文，媒体 bucket 不公开。
- 备份 ZIP 与永久删除都属于高风险私密操作；仅馆长可见，响应使用 `no-store`，并通过确认短语再次校验。
- 示例与本地 seed 内容均为虚构占位数据，不含真实儿童素材。
