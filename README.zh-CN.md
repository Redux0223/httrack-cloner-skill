<p align="center">
  <img src="docs/assets/hero.svg" alt="HTTrack Cloner Skill" width="100%">
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  <a href="https://github.com/Redux0223/httrack-cloner-skill/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Redux0223/httrack-cloner-skill/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-16A085?style=for-the-badge" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/tests-123%20passing-E0A928?style=for-the-badge" alt="123 tests passing">
  <img src="https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white" alt="React 19">
</p>

<p align="center">
  <strong>给 Coding Agent 一个已授权 URL，得到可二次开发的本地 React 项目和已打开的浏览器预览。</strong>
</p>

`httrack-cloner-skill` 是一套自包含工作流，用于将已授权网站重构为本地 **React + TypeScript + TanStack Router** 项目。它会调用 HTTrack 抓取部署文件，补全运行时资产，清理自动外部请求，完成构建和浏览器验证，并打开本地预览。

> [!IMPORTANT]
> 仅用于你有权抓取、修改和重新分发的网站及资产。

## 案例展示

<p align="center">
  <a href="docs/cases/httrack-cloner-showcase.mp4">
    <img src="docs/cases/httrack-cloner-showcase.gif" alt="Santioni Spirits 与 2xA Studio 本地重构案例" width="100%">
  </a>
</p>

<p align="center">
  <strong>Santioni Spirits · 2xA Studio</strong><br>
  画面录制自本地重构项目，点击可查看高清 MP4。
</p>

仓库不分发测试网站源码或原始第三方资产。

## 核心流程

| 阶段 | 结果 |
| --- | --- |
| 抓取 | 限定域名的 HTTrack 镜像和资产清单 |
| 分析 | 路由、脚本、运行时资产和交互合同 |
| 重构 | React 19、TypeScript、Vite 和 TanStack Router |
| 本地化 | 视频、字体、Worker、WASM、模型和纹理 |
| 验证 | 类型检查、生产构建、路由探测和浏览器诊断 |
| 交付 | 干净项目目录和已打开的本地预览 |

## 快速开始

```bash
git clone https://github.com/Redux0223/httrack-cloner-skill.git
cd httrack-cloner-skill
npm ci --prefix scripts

mkdir -p ~/.codex/skills
ln -s "$(pwd)" ~/.codex/skills/httrack-cloner-skill
```

直接给 Agent 一个 URL：

```text
请使用 $httrack-cloner-skill 处理 https://example.com/
```

也可以直接运行：

```bash
node scripts/run-url.mjs --url "https://example.com/" --authorized --depth 3
```

恢复 repair loop：

```bash
node scripts/run-url.mjs --resume "/absolute/path/to/run"
```

## 环境要求

- Node.js 20+ 和 npm
- `PATH` 中可用的 HTTrack
- Playwright Chromium 运行依赖
- 抓取阶段可访问已授权源站

```bash
# macOS
brew install httrack

# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y httrack

npx --prefix scripts playwright install chromium
```

## 交付目录

```text
clone-runs/<host>-<timestamp>-<id>/
├── mirror/       # 源站镜像和资产清单
├── react/        # 可二次开发的 React 项目
├── proof/        # 浏览器验证证据
└── .cloner/      # trace、状态和修复记录
```

复杂生产 Bundle 可能通过清理后的本地 React adapter 挂载，以避免自动重写改变原始行为。报告会区分“项目可交付”和“视觉一致性”，不会在缺少证据时宣称像素级还原。

## 安全与限制

- 抓取默认限定域名，并强制要求 `--authorized`。
- 自动外部运行时请求会被阻断或报告。
- 实时 API 需要确定性的本地替代行为。
- WebGL、Canvas 和压缩 Bundle 可能需要本地 adapter。
- 不支持绕过登录、CAPTCHA、DRM、付费墙或访问控制。
- 授权报告是技术证据，不构成法律意见。

## 开发

```bash
npm ci --prefix scripts
npm run validate
```

仓库包含 123 个测试，覆盖抓取、资产、本地化、React 转换、TanStack 路由、外部请求清理、浏览器 Proof、repair loop 和干净复现。

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请查看 [SECURITY.md](SECURITY.md)。

## 许可证

Skill 代码使用 [MIT License](LICENSE)。生成项目和抓取资产仍受原始所有权与许可证约束。
