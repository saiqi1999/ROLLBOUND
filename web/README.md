# ROLLBOUND 轮盘战记

七店七战的单机构筑原型。玩家在商店的 4×4 轮盘发展阵容，再观看自动战斗。支持手机竖屏和桌面浏览器。角色动画来自仓库的 `Assets/Game/Art`。

货架每次出三张棋子。第四格各有 50% 的概率出法术或魔法标签。购买标签后，在「打标签」页选择队员应用，每枚棋子至多保留一枚标签。轮盘与标签页都在棋子格右上角显示标签。位置标签在付费摇盘时优先落入对应四格。战斗标签可以追加命中、生成分身、恢复生命、增加护盾或在阵亡时强化其他友方。成长标签在开战前永久强化棋子。第 2、4、6 战获胜各获得一枚移除标签。

此版本使用独立的新档键，打开后从第一间商店开始。

## 运行

从仓库根目录安装 Node.js 24 后执行：

```sh
cd web
npm ci
npm run dev
```

同一局域网的手机可通过终端显示的 Network 地址试玩。运行 `npm run build` 生成 `dist/`。使用 `npm test` 检查商店结算、战斗补员、阵亡成长和七战流程。

运行 `node scripts/simulate-difficulty.mjs 1200 200000` 测算默认每店摇两次的策略。相同种子下可加 `--tags` 比较允许购买并贴标签、`--recruit` 比较只招募、`--spin` 比较每店摇四次、`--grow` 比较后期逐步多摇，或用 `--skip-recruit=4` 测试第四店跳过单位购买。

[商店轮盘改造方案](../docs/ROLLBOUND-商店轮盘改造方案.md)

## 服务器阵容日志

记录版通过同源 `/api/battle-lineups` 把开场阵容写入 D1。一次开战对应一个 `battleId`，战果和战斗步数在同一条记录上补齐。`runId` 可关联同次远征的各轮，`seed` 和 `ruleset` 可用于复盘对应版本。开场分身包含 `cloneOf`，候补按实际入场顺序记录。连接中断时，未确认的记录会在回到页面、恢复网络或下一次战斗时重试。

商店或结算页的「导出阵容日志」会下载 NDJSON，每行对应一场战斗。可用 `pandas.read_json("rollbound-lineups.ndjson", lines=True)` 读取。服务端只保存规则版本、随机种子、开战时间、轮次、阵容、已装填火球数与战果。

部署记录版时，从仓库根目录用 `VITE_LINEUP_LOGGING=1 npm --prefix web run build` 构建客户端，再运行 `node web/scripts/build-recorded-site.mjs` 打包 Worker。部署目录的 `.openai/hosting.json` 声明 `d1: "DB"`，生产数据库部署时应用 `drizzle/` 的迁移。阵容日志采集由记录版启用。
