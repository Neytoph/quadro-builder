# 真实装配测试夹具

本目录供装配规划及说明书回归测试使用，保存真实模型的完整原始内容。它不在 `public/` 中，产品源码不引用这些文件，Vite构建不会将其复制到 `dist/`。

- `s33.json`：小麦坊广场真实s33模型，来源 `https://xiaomaifang.com/quadro/plaza/schemes/s33/model`。
- `s36.json`：小麦坊广场真实s36原始模型，来源 `https://xiaomaifang.com/quadro/plaza/schemes/s36/model`；保留原始端口冲突，用于阻止不实导出及真实修正回归。
- `C0179-baseline.json`：官方 `public/qdf/C0179.qdf` 在Builder `df783e38` 上的真实模型、装配计划与BOM快照，用于始终执行20/80/120cm三层全部39根原水平管的逐项比对。它不是当前规划结果，也不在测试运行时生成或覆盖。

上述文件完整复制自已验收任务 `XMF-ASSEMBLY-MANUAL-20261004` 的 `builder/public/assembly-fixtures/s33.json`、`s36.json` 及 `qa/frame-followup/C0179-baseline.json`，没有重新编造或裁剪。官方QDF仍直接读取仓库的 `public/qdf/`。测试证据输出至已被Git忽略的 `.work/assembly-qa/`，不依赖任务工作区或临时公开目录。

固定原始文件SHA-256：

| 文件 | SHA-256 |
|---|---|
| s33.json | `3e90857a738c6176b4f946d551b0cde56d829187b2bb048f403c8aa63cf36e98` |
| s36.json | `64a673753e850969fc249f7493bb990d5e0d8c3f2fa71716a0a5d46b7faa6220` |
| C0179-baseline.json | `bf0af99a0d199f7fec24f1c914841b6b089fb35226f1fc9482989d772a15601d` |
