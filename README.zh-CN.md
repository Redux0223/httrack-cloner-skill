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
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 20+">
</p>

<p align="center">
  <strong>给 Coding Agent 一个已授权 URL，得到可二次开发的本地 React 项目和已打开的浏览器预览。</strong>
</p>

`httrack-cloner-skill` 是一个自包含的 Agent Skill，用于将**已授权网站**重构为本地 **React + TypeScript + TanStack Router** 项目。它会调用 HTTrack 抓取部署文件，补全运行时资产，生成类型安全的 React 路由，移除自动外部运行时请求，完成构建和浏览器验证，并打开本地预览。

它不是在线扒站服务，而是一套给本地 Coding Agent 使用的完整工程 SOP。Skill、脚本、参考文档、验证闭环和修复流程都包含在仓库中。

> [!IMPORTANT]
> 仅用于你有权抓取、修改和重新分发的网站及资产。自动生成的授权清单只是技术证据，不构成法律意见。

## 案例展示

<p align="center">
  <a href="docs/cases/httrack-cloner-showcase.mp4">
    <img src="docs/cases/httrack-cloner-showcase.gif" alt="Why Zero 与 2xA Studio 本地重构案例展示" width="100%">
  </a>
</p>

<p align="center">
  <strong>所有画面均录制自本地重构项目的真实预览。</strong><br>
  Why Zero 展示 Canvas 交互与 WebGL 滚动转场；2xA Studio 展示本地视频、生成式视觉和长页面动效。点击预览可打开高清 MP4。
</p>

视频来自已授权的本地验证任务。仓库不分发测试网站源码或原始第三方资产。

## 为什么需要它

HTTrack 能下载可发现的页面和资源，但现代网站通常还包含：

- 动态 import 和运行时拼接的资源路径；
- 视频、字体、Worker、WASM、WebGL Shader、模型和纹理；
- 依赖浏览器生命周期的命令式启动代码；
- 无法直接映射为下载文件的前端路由；
- 不应保留在本地项目中的远程服务和追踪器。

本 Skill 将原始镜像变成一条可以恢复、修复和验证的工程链路。

## 核心流程

| 阶段 | 产物 |
| --- | --- |
| 抓取 | 限定域名的 HTTrack 镜像和资产哈希清单 |
| 分析 | 路由、脚本、行为合同、运行时资产和 Bootstrap 证据 |
| 重构 | React 19、TypeScript、Vite、TanStack Router 文件路由 |
| 本地化 | 本地资源和自动请求网络边界 |
| 验证 | Typecheck、生产构建、路由探测和浏览器 Proof |
| 交付 | 干净项目目录和已打开的本地预览 |

<p align="center">
  <img src="docs/assets/pipeline.svg" alt="抓取、分析、重构、本地化、验证、交付" width="100%">
</p>

## 快速开始

### 1. 安装 Skill

```bash
git clone https://github.com/Redux0223/httrack-cloner-skill.git
cd httrack-cloner-skill
npm ci --prefix scripts
```

链接到 Codex Skill 目录：

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)" ~/.codex/skills/httrack-cloner-skill
```

### 2. 直接给 Agent 一个 URL

```text
请使用 $httrack-cloner-skill 处理 https://example.com/
```

URL 就是完整调用。Agent 应自行创建 fresh run、处理 repair loop、构建项目并打开预览，不需要用户提供工作目录。

### 3. 直接运行确定性入口

```bash
node scripts/run-url.mjs \
  --url "https://example.com/" \
  --authorized \
  --depth 3
```

如进入 `REPAIR_LOOP`，继续恢复同一个 run：

```bash
node scripts/run-url.mjs --resume "/absolute/path/to/run"
```

## 环境要求

- Node.js 20+
- npm
- `PATH` 中可用的 HTTrack
- Playwright Chromium 运行依赖
- 抓取阶段可访问已授权源站
- 足够存储视频、模型、纹理和复现副本的磁盘空间

```bash
# macOS
brew install httrack

# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y httrack

# Proof 浏览器
npx --prefix scripts playwright install chromium
```

## 交付目录

```text
clone-runs/<host>-<timestamp>-<id>/
├── mirror/                  # 源站镜像和资产清单
├── react/                   # 可二次开发的交付项目
│   ├── src/pages/           # React 页面
│   ├── src/routes/          # TanStack Router 文件路由
│   ├── src/runtime/         # 本地网络策略和运行时适配器
│   ├── public/              # 本地资产
│   └── reports/             # 转换与交付报告
├── proof/                   # 源站与本地浏览器证据
└── .cloner/                 # 状态、trace、调用与修复记录
```

## Production-first 交付模型

Skill 会严格区分“项目已经可交付”和“视觉 Proof 已经通过”：

- 构建、类型检查、本地资产、自动外部请求、干净复现、路由 HTTP 探测和浏览器打开属于交付信号。
- 文本、几何、动画相位、标题和截图差异会作为 parity diagnostics 记录。
- 对于复杂 WebGL 或生产 Bundle，首轮结果可能保留本地 sanitized runtime，并通过 React 挂载。此时应称为 **React adapter**，不能伪称纯 React rewrite。
- `delivery-manifest.json` 会分别记录 `proofPassed` 和 `proofDiagnosticAccepted`。

这样既不会因为 Proof 工具超时而阻断可用项目，也不会在存在差异时虚假宣称像素级还原。

## 关键报告

| 报告 | 用途 |
| --- | --- |
| `conversion-manifest.json` | 路由、资源分类、已移除引用和转换模式 |
| `authorization-manifest.json` | 文件哈希、来源提示和授权证据 |
| `no-external-runtime.json` | 自动外部请求与远程字符串分析 |
| `local-assets.json` | 浏览器可达本地资产闭合情况 |
| `architecture-verification.json` | Router、React、Bootstrap 和 Engine 诊断 |
| `proof-summary.json` | 桌面/移动端源站与本地比较 |
| `reproducibility.json` | 干净安装、构建、预览和路由探测 |
| `delivery-manifest.json` | 最终项目、预览、Proof 与交付状态 |

## 测试覆盖

仓库包含 **123 个自动化测试**，覆盖：

- HTTrack 抓取和授权参数；
- 动态资产、重试、超时和内容签名；
- React 属性转换和 TanStack 路由；
- 伪装为 HTML 的 404 资产响应；
- 自动外部请求清理；
- WebGL、Canvas 和 runtime adapter 合同；
- 滚动锁、鼠标、长按、媒体和移动端 Proof；
- production-first Proof 语义；
- 干净复现和浏览器预览交付。

仓库不包含任何真实测试网站的抓取代码或第三方媒体资产。

## 安全与合规

- CLI 强制要求明确传入 `--authorized`。
- 默认限制抓取域名范围。
- 凭证和常见 Tracker 会被移除或报告。
- 自动外部运行时请求必须被清理或明确本地化。
- 不得用于绕过登录、CAPTCHA、DRM、付费墙、访问控制或网站条款。
- 授权报告不会自动赋予你使用第三方内容的权利。

## 已知限制

- 压缩后的生产 Bundle 不一定能自动变成完全手写风格的 React 源码。
- Canvas/WebGL 网站可能需要先保留本地 runtime adapter。
- 实时 API 需要定义确定性的本地替代行为。
- Proof 可以识别差异，但不能自动修复所有设计和动画问题。
- 无法抓取不可访问、需要认证、受 DRM 保护或依赖已下线服务的字节。

## 开发与测试

```bash
npm ci --prefix scripts
npm test
npm run validate
```

## 贡献

欢迎提交通用抓取 Fixture、运行时适配器、验证器改进和 Bug 修复。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

请勿提交受版权保护的网站镜像、生产 Cookie、私有凭证或第三方媒体。

## 许可证

Skill 代码使用 [MIT License](LICENSE)。生成项目和抓取的源站资产仍受其原始所有权与许可证约束。
