// 检查脚本里的 Builder 接上编辑记录，和应用里一样：模型此刻的样子写进一份 Yjs 文档，
// 之后的编辑、撤销都经过它。
const { ModelHistory } = await import('../src/collab/history.ts')
const { docFromJSON } = await import('../src/collab/ymodel.ts')

export function withHistory(builder) {
  builder.setHistory(new ModelHistory(docFromJSON(builder.model.toJSON())))
  return builder
}
