# Quadro Builder

QUADRO 攀爬架 3D 设计器。**不是**把 vokako/quadro-3d-designer 整仓拷过来当底座。

- **界面**：按 [vokako/quadro-3d-designer](https://github.com/vokako/quadro-3d-designer) 重做（深色工作台、悬浮顶栏、左侧选色/文件、右侧料表）。
- **功能核**：直接使用 [thecodingdad/quadro-3D](https://github.com/thecodingdad/quadro-3D) 的引擎——图模型、官方网格、QDF 进出、料表、库存核对、45° 袖轴、滑梯链、配件、逐层拼装。

两边都是 MIT。QUADRO 是原厂商标，本项目是非官方社区工具。

## 本地运行

需要 Node 22+。本机若装了 Homebrew `node@24`：

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm install
pnpm dev          # http://localhost:5173
pnpm exec tsc -b --noEmit
pnpm build
```

## 怎么搭

1. 顶栏选「管」，再点场景里的绿点或接头接管。连接件会按管子自动长出来。
2. 「面板」：先点一根承重管，再点对面那根。
3. 「滑梯」选官方四种后点挂钩或滑梯链。
4. 轮 / 布 / 泳池 / 45° / 双管：从顶栏拿出，吸到高亮点上。
5. 底部「逐层拼装」按真实顺序显隐；右下角是存档和库存核对。

`.qdf` 可与原厂软件交换。官方网格和特殊件用 JSON 保真。

## 目录

```
src/engine/     quadro-3D 功能核（Vanilla JS，仅改了数据路径和 Three 导入）
src/ui/         vokako 风格 React 壳
src/store/      引擎 ↔ React 桥
public/data/    零件目录 + 从 Quadro.exe 抽出的网格
```
