# ROLLBOUND 轮盘战记

七店七战的单机构筑原型。玩家在商店的 4×4 轮盘发展阵容，再观看自动战斗。支持手机竖屏和桌面浏览器。角色动画来自仓库的 `Assets/Game/Art`。

货架每次出三张棋子。第四格各有 50% 的概率出法术或魔法标签。购买标签后，在「打标签」页选择队员应用，每枚棋子至多保留一枚标签。轮盘与标签页都在棋子格右上角显示标签。位置标签在付费摇盘时优先落入对应四格。战斗标签可以追加命中、生成分身、恢复生命、增加护盾或在阵亡时强化其他友方。成长标签在开战前永久强化棋子。第 2、4、6 战获胜各获得一枚移除标签。

此版本使用独立的新档键，打开后从第一间商店开始。

自动交战时，棋子向最近的敌人移动，进入射程后停下攻击。已锁定目标在存活且仍处于射程内时持续有效，目标阵亡或离开射程后重新就近选敌。双重和三重的额外命中也按距离选敌。

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

## GitHub Pages 试玩采集

配置上传地址后，完成一局远征时，网页版会上传开场阵容、轮次、规则版本、随机种子、战果和步数。Worker 把完整记录写入 `newkey_version1:<16 位结算毫秒时间戳>:<runId>`。相同上报重试复用原来的 key。当前远征的待提交阵容随存档恢复，提交成功后从存档移除明细。单局报告使用 `schemaVersion: 1`，每场战斗沿用 `LineupRecord`。

导出按 `newkey_version1:` 前缀分页汇总。部署后的导出会分批迁移 `run:` 和 `playtest:all`。Worker 校验新 key 的完整内容和可枚举性后清理迁移来源。过渡期间导出按 `runId` 合并两种格式，`migrationComplete` 表示旧 key 已清理完毕。

Cloudflare Workers Builds 使用仓库根目录的 `wrangler.jsonc`。连接 `main` 时，Worker 名填 `rollbound`，根目录留空或填 `/`，Build command 留空，Deploy command 填 `npx --yes wrangler@4 deploy`。部署会绑定 `PLAYTEST_RUNS` 和串行写入使用的 `PLAYTEST_ARCHIVE`。

也可以登录 Cloudflare 后，从仓库根目录运行以下命令。

```sh
npx wrangler@4 login
npx wrangler@4 deploy
```

GitHub Pages 默认使用 `https://rollbound.cardinal-99.workers.dev/api/lineup-runs`。更换服务时，在 Actions variables 中把 `ROLLBOUND_PLAYTEST_RUNS_URL` 设为新的公开上传地址，然后运行 **Build and deploy ROLLBOUND**。Worker 从 `https://saiqi1999.github.io` 接收 JSON，开启请求限流和数据格式校验。

在 GitHub Pages 页面底部展开「试玩记录」，点击「导出 JSON」可下载共享的匿名对局档案。文件的 `runs` 按 `runId` 保存完整的各轮记录，可用于模拟和筛选影子对手。

分析时由受授权的环境设置 `CLOUDFLARE_ACCOUNT_ID`、`ROLLBOUND_KV_NAMESPACE_ID` 和仅有 **Workers KV Storage Read** 权限的 `CLOUDFLARE_API_TOKEN`。从仓库根目录导出，每行是一局，可展开 `battles` 按规则版本、轮次或战果分析。

```sh
node web/scripts/export-playtest-runs.mjs > rollbound-playtest-runs.ndjson
```

## 影子对战

第 4、7 战按战斗规则版本和轮次各自匹配。网页开局获取阵容，分别保存每一战实际拿到的首发、候补、攻血、护甲和标签。缺少的场次会在进店和该战开打前继续尝试。某轮仍没有可用镜像时，使用对应的原关卡阵容。页面底部的「试玩记录」显示本局拿到了哪些战次的线上影子对手。

GitHub Pages 底部的「写入认可名单」会导入 `PLAYTEST_APPROVAL_BATCH` 指定的对局。Worker 按归档 key 的 SHA-256 和结算时间找到完整记录，校验指定轮次后，把认可结果合并到 KV 的 `mirror:approved` 并重建连续编号。每批导入一次，重试会返回同一批的结果。第 4–7 战的认可阵容均可写入池中，游戏开局从第 4、7 战取样。

在 `rollbound-playtest-runs` 的 KV Pairs 手动创建或编辑 `mirror:approved`。`runId` 填全量包里选定的局 ID，`ruleset` 和 `rounds` 取自该局允许匹配的战斗。以下格式示例里的 `runId` 需要替换为已选记录。

```json
{
  "schemaVersion": 1,
  "opponents": [{ "runId": "替换成选定的 runId", "ruleset": 4, "rounds": [4, 7] }]
}
```

空名单用 `{"schemaVersion":1,"opponents":[]}`。要发布编辑后的名单，在同一命名空间设置 `approvedkey_version1:refresh`，Value 填本次刷新的 Unix 毫秒时间戳，例如 `1795840507465`。每次刷新使用一个大于上次的时间戳。下次开局匹配时，Worker 会按结算时间为每个规则版本和轮次重新排 `1…N`，把快照写到 `approvedkey_version1:<ruleset>:<round>:<批次>:<id>`，再更新 `approvedkey_version1:manifest` 的批次和数量。完整对局可通过 `newkey_version1:` 导出。游戏开局从当前批次的 `1…N` 之间随机取阵容。
