# Quadro Builder

QUADRO 攀爬架的浏览器 3D 设计器。零件按官方网格搭，料表能对库存，`.qdf` 能和原厂软件互相打开。

界面按 [vokako/quadro-3d-designer](https://github.com/vokako/quadro-3d-designer) 重做；搭建、QDF、料表、官方网格用的是 [thecodingdad/quadro-3D](https://github.com/thecodingdad/quadro-3D) 的引擎。两边都是 MIT。本项目**不是**把 designer 整仓拷过来当底座，3D 也不是 React Three Fiber。

QUADRO 是原厂商标。这是非官方社区工具，和 QUADRO GmbH 没有关系。

## 本地运行

需要 Node 22+ 和 [pnpm](https://pnpm.io/)。本机若用 Homebrew 的 `node@24`：

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm install
pnpm dev
```

浏览器打开终端里打印的地址，一般是 `http://localhost:5173/`。端口被占用时 Vite 会顺延。

```bash
pnpm exec tsc -b --noEmit   # 类型检查
pnpm build                  # 产出 dist/
pnpm preview                # 预览生产包
```

## 怎么搭

顶栏从左到右是：选择、管、面板、连接件、轮、布件、泳池、滑梯、加固。左栏改颜色、起步造型和视图；右栏是零件清单、模型库和存档。

1. **管**：选长度后点接头上的箭头，往空方向接一根。连接件会按已经接上的管子长出来。
2. **连接件**：空场景会直接落在原点。已经有结构时，只高亮还能套上所选型号的现有接头（还要留得下空插座）。点一下换成该通型，再点可转动空插座；不会在空气里的网格邻点长新节点。Esc 或换工具退出。
3. **面板**：先点一根承重管（琥珀色），再点对面那根绿色的。
4. **滑梯**：选官方四种之一，点挂钩或滑梯链位置。
5. **轮 / 布 / 泳池 / 45° / 双管 / 管夹 / 孔锁 / 柔性接头**：从顶栏拿出，吸到高亮点上。
6. **加固**：点两根共线的 35 cm 管，插入 80 cm 木芯。
7. 底部 **逐层拼装** 按真实搭建顺序显隐；`[` `]` 翻步。

左栏「起步造型」会整份替换当前设计（可撤销）。「单体组件」挂到指针上，放到现有造型上会合并去重。

`.qdf` 从「文件」导入或导出，可与原厂软件交换。官方网格和特殊件用 JSON 保真。

### 常用操作

快捷键按系统显示：Mac 用 ⌘，Windows 用 Ctrl。

| 操作 | 键 |
| --- | --- |
| 撤销 / 重做 | ⌘Z / ⇧⌘Z（Windows：Ctrl+Z / Ctrl+Y） |
| 保存 | ⌘S |
| 全选 | ⌘A |
| 复制 / 粘贴 | ⌘C / ⌘V。粘贴后 ↑↓ 升降，点击放下，Esc 取消 |
| 选择整块 | 双击，或 L，或左栏「选择整块 L」。Shift/⌘ 加点选 |
| 删除模式 | D。点零件逐个删除，Esc 或再按 D 退出 |
| 删除选中 | Delete / Backspace |
| 框住模型 | F |
| 退出当前模式 | Esc |

当前模式下能用的键会列在左下角，点标题可以收起。

相机：拖动旋转；Mac 用 ⌥ 拖或 ⇧+双指横移、双指缩放；Windows 用 Alt 拖或 Shift+滚轮横移、滚轮缩放。

界面语言在左栏切「中 / EN / DE」。

## 目录

```
src/engine/     搭建引擎（Vanilla JS；相对上游只改了数据路径和 Three 导入）
src/ui/         工作台界面
src/store/      引擎和 React 之间的桥
src/data/       起步造型、官方模型列表、套装建议
public/data/    零件目录，以及从原厂程序抽出的网格
```

## 许可

MIT。见 [LICENSE](LICENSE)。
