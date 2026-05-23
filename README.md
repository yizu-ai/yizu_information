# 一卒的信息源

一个本地优先的信息源筛选池。当前 demo 接入 GitHub Trending，支持用 AI 生成中文项目说明、收藏、忽略、星级、备注和历史日期切换。

## 技术栈

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Express 本地 API
- JSON 文件本地保存反馈

## 本地运行

```bash
npm install
npm run dev
```

默认地址：

```text
http://localhost:18765
```

## 生成 GitHub 日报

```bash
npm run generate -- --date 2026-05-23 --url https://github.com/trending?since=daily
```

如果本地配置了 `data/settings.local.json` 或环境变量 `DEEPSEEK_API_KEY`，生成时会调用 DeepSeek；否则会退回本地规则摘要。

## Vercel 部署说明

当前部署只需要构建前端和读取仓库内已生成的 `data/reports/*.json`，没有必填环境变量。

可选环境变量：

```text
DEEPSEEK_API_KEY=你的 DeepSeek APIK
```

说明：Vercel 的函数文件系统不适合作为长期数据库。线上点击收藏、星级、备注会在临时目录里生效，但不保证长期持久保存。后续如果要线上长期保存反馈，需要接入 Vercel KV、Postgres 或其他数据库。

## 常用验证

```bash
npm test
npm run lint
npm run build
```
