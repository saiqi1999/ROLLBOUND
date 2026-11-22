# ROLLBOUND 轮盘战记

七店七战的单机构筑原型。玩家在商店的 4×4 轮盘发展阵容，再观看自动战斗。支持手机竖屏和桌面浏览器。角色动画来自仓库的 `Assets/Game/Art`。

## 运行

从仓库根目录安装 Node.js 24 后执行：

```sh
cd web
npm ci
npm run dev
```

同一局域网的手机可通过终端显示的 Network 地址试玩。运行 `npm run build` 生成 `dist/`。使用 `npm test` 检查商店结算、战斗补员、阵亡成长和七战流程。

运行 `node scripts/simulate-difficulty.mjs 1200 200000` 测算默认每店摇两次的策略。相同种子下可加 `--recruit` 比较只招募、`--spin` 比较每店摇四次、`--grow` 比较后期逐步多摇，或用 `--skip-recruit=4` 测试第四店跳过单位购买。

[商店轮盘改造方案](../docs/ROLLBOUND-商店轮盘改造方案.md)
