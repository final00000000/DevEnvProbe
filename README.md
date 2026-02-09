# DevEnvProbe

一个基于 Tauri 的轻量级系统监控工具，提供实时的系统资源监控功能。

## 功能说明

- **CPU 监控** - 实时显示 CPU 使用率，支持多核心数据展示
- **内存监控** - 追踪系统内存使用情况，包括已用/可用内存
- **磁盘监控** - 监控磁盘空间占用情况
- **Docker 监控** - 实时查看 Docker 容器状态和资源占用
- **趋势图表** - 可视化展示系统资源使用趋势

## 技术栈

- 前端：TypeScript + Vite + Tailwind CSS
- 后端：Rust + Tauri 2.x
- 构建工具：Vite

## 开发环境

推荐使用以下工具：
- [VS Code](https://code.visualstudio.com/)
- [Tauri 插件](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [Rust Analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run tauri:dev

# 构建应用
npm run tauri:build
```
