# ROLLBOUND 轮盘战记

三店三战的单机轮盘构筑原型。支持手机竖屏与桌面浏览器。角色动画来自仓库的 Assets/Game/Art。

## 运行

从仓库根目录安装 Node.js 24 后执行：

```sh
cd web
npm ci
npm run dev
```

同一局域网的手机可通过终端显示的 Network 地址试玩。正式静态文件运行 npm run build 后生成在 dist/。使用 npm test 检查单位联动、随机攻击、阵亡成长以及三场战斗的确定性。

[玩法与工程设计](../docs/网页原型设计方案.md)
