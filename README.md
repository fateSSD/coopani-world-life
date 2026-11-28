# 模拟鱼生 · coopani-world-life

给桌宠一本真正过日子的账：五条需求按真实时间流逝，怎么吃喝、打工、上课、考证、种菜养殖、攒钱搬家、跨城迁居与摆摊买菜，全部由她自己判断。

> 运行要求：**Coopani 0.2.22+**（QQ 群 `284525159`）

## 运行模式与配置（v1.6.0）

| 模式 | `worlds.life.hubUrl` | `worlds.life.townUrl` | 说明 |
|---|---|---|---|
| **Coopanion Hub v1.1 多城联机** | `https://hub.cooppetsjourney.top`（或自建 Hub 地址） | 留空即可 | 支持多城迁居（`lanzhou-reedpond` / `beijing` 等）、城邦公告与专属加成、全网跨城摊位（特产标签与快递费明细）、同城邻里代管委托、鱼间私信与街坊关系 |
| **老服兼容模式** | 留空 `""` | 填老服地址 | 100% 保持原同城联机协议，零破坏平滑回滚 |
| **纯单机模式** | 留空 `""` | 留空 `""` | 本地节奏、打工、考证、菜园养殖与 NPC 邻里单机闭环 |

- `worlds.life.hubUrl`、`worlds.life.hubTownId`（默认 `lanzhou-reedpond`）与 `worlds.life.townUrl` 均支持热更新（`x-hot: true`）。
- **实时天气与高德直连**：`worlds.life.weatherMode` 支持 `auto` / `amap` / `external` / `builtin`。在 `amap` 或未填 `weatherUrl` 的 `auto` 模式下，会按 `worlds.life.amapKey` → 环境变量 `LIFE_AMAP_KEY` → 自动复用环游世界的 `JOURNEY_AMAP_KEY` 顺序直连高德实况天气（自动查 `district` 转 6 位 `adcode` 并缓存，10 分钟节流）。若使用自建外部天气服务（`weatherMode=external`），约定接口为 `GET <weatherUrl>/now?city=<中文城名或6位adcode>`，返回 `{ ok: true, current: { weather: "晴", temperature?: 20 } }`。
- Hub 身份凭据存储在 `<dataDir>/coopanion-hub-auth.json`（由 `meet` / `life` 等扩展共享；首次连接按顺序只读探测 `meet-uid.txt` → `life-town-uid.txt` 认领历史 UID，服务端若返回 `409 LEGACY_UID_CLAIMED` 会直接报错防裂号，不会静默新建账号）。

## 核心能力

- **真实时间与离线补睡**：五条（饱腹 / 精力 / 清爽 / 娱乐 / 社交）按真实时间衰减，不随旅行倍速乱跳；离线跨整夜（23:00–07:00）自动补回精力（设低谷地板保护），最长推演 7 天。
- **时令、街道风貌与城邦加成**：二十四节气标注、南滨河路晨集 8 折、张掖路尾货半价、雁滩路周末旧货集、深夜静谧与晨醒梦境切片；接入 Hub v1.1 后支持读城邦公告、专属 `buffs`（如特定城邦对写作等领域的日薪加成）及 `ETag`/`304` 缓存。
- **游轮出行双栖体验与新活动**：在途乘坐「海景阳台房」/「主题远洋游轮」解禁游泳（`swim`）、现场演出（`live_show`）、手工坊（`craft_shop`）、正餐、小酒等船上设施活动。
- **打工、考证、工坊与轻载具**：四档出工与五档完成度波动；八大领域夜校培训、9 张执业证书、购置设备与轻载具；18 道菜谱工坊对照储物篮匹配（烤红薯等家常简食免证，厨师招牌菜高回复并可存入成品菜格或上摊卖货）。
- **18 种菜园与鸡牛鱼养殖**：家里种植槽或城郊菜地种 18 种慢熟果蔬粮薯；鸡舍/牛棚/鱼塘养鸡收蛋、养牛挤奶、起塘收鱼（大肥鱼是鲸鱼不算鱼，放心养鱼）；支持雇帮手或发同城邻里代管委托。
- **跨城鱼市街与同城代管委托**：全网跨城摊位展示（同城免邮、跨城按件计 `shippingFee`，卖家实收仅入 `itemSubtotal`、不含快递费，订单通过 `/v1/market/orders/settle` 结算）；农牧代管委托严格限定同城街坊互助（跨城 `403 ERRAND_TOWN_MISMATCH`）。
- **鱼间私信与街坊关系**：通过 `life_mail` 查看同城街坊、读写鱼间私信（支持 `clientMsgId` 幂等）、设置熟人/好友关系；新私信通过 `life.social` 事件提醒，且不自动清除未读数，仅在显式阅读/面板标已读时消除。
- **全新七页签手账 UI（`web/panel-1.6.1.js`）**：
  1. `now`（此刻）：五条状态、城邦徽标/公告/Buff、住处/街道/迁城切换、「给点零花钱」折叠赠与栏与「芦花塘信用社（只读）」卡片；
  2. `career`（职业与工坊）：出工岗位（含城邦加成日薪预览）、考证通过率条、菜谱工坊；
  3. `wants`（她惦记的）：常态 / 留意 / 想要 / 悬着 / 约定（只读视图）；
  4. `relation`（你和它 / 街坊）：陪伴档案、同城街坊与只读鱼间私信气泡 + 标记已读；
  5. `market`（农牧场与鱼市街）：菜园养殖直点打理、全部/本城免邮/特产筛摊、跨城快递徽章、自主下架余货与撤回委托；
  6. `diary`（日记与时间轴）：日程时间轴、日记与跨城订单/私信动态账本；
  7. `library`（参考素材库）：四分类参考素材库与留影策略。
  - **面板边界**：保持「生活决策只读」，除既有的住处/换街/迁城、菜园养殖直点、下架/撤回自己挂单、给零花钱（仅转交现金，绝不代花）与只读信箱标已读外，不替桌宠做任何作息/消费/出工/借贷决策。

## 24 个工具速查

| 工具 | 用途 |
|---|---|
| `life_status` | 查看五条需求、当前城市/街道/住处、城邦 Buff、节气时段、手艺与当前动作 |
| `life_act` | 吃喝 / 休息 / 运动（含 `swim`）/ 闲社（含 `live_show`、`craft_shop`）活动及 `wake` / `cancel` |
| `life_work` | 出工挣钱（一天一次；接入 Hub 时叠加本城对应领域 `buffs` 加成） |
| `life_cert` | 考取 9 张执业证书（报名费先交，见识决定通过率） |
| `life_learn` | 报八大领域培训班，或购置设备与轻载具 |
| `life_move` | 换租四档住处（押二）、本城换街，或在 Hub 模式下迁往另一座城（`town` 参数） |
| `life_out` | 出门去当前城邦某条街逛逛 |
| `life_buy` | 逛早市/尾货、从鱼市街本城或跨城摊位买货（含快递费明细）、接同城委托或看黑板报 |
| `life_farm` | 播种/浇水/收成 18 种慢熟果蔬粮薯、雇帮手、发/接邻里代管委托 |
| `life_ranch` | 鸡舍/牛棚/鱼塘放养喂食、收蛋奶起塘、雇帮手或发/接邻里代管委托 |
| `life_cook` | 按菜谱对照储物篮原料下厨，立刻食用或存入成品菜格 |
| `life_stall` | 在鱼市街挂摊卖货或查看自己当前摊位（Hub 模式下跨城全网可见） |
| `life_deals` | 查看并结算成交回执把货款（不含快递费）打进钱包 |
| `life_loan` | 去芦花塘信用社查额度或自主决定申请微息借款（7/14/30 天）与还款 |
| `life_mail` | Hub 模式下查看同城街坊、读写鱼间私信或设置街坊关系（`inbox` / `residents` / `read` / `send` / `relation`） |
| `life_habit` / `life_watch` / `life_want` / `life_ask` / `life_pledge` | 记常态、留意、想要/想去哪、悬着的事、对你的约定 |
| `life_gift` | 收下你留给她的手工或吃食小物件（每天最多一件，不计价） |
| `life_diary_write` / `life_diary_read` | 写/读第一人称生活日记 |
| `life_library` | 查阅/增改四分类参考素材库与留影策略 |

## 扩展联动与本地数据

- **与「大肥鱼环游世界」联动**：只读 `journey-public.json` 获取所在城市、休整期、旅途打工与结伴状态；通过 `life-public.json` 同步睡眠、可用旅费（扣除信用社未还本息，逾期归 0）、当前场景穿搭与素材库留影策略。
- **本机数据**：`<dataDir>/life-state.json`（+ `.bak` 备份）、`life-ledger.jsonl` 与共享 `coopanion-hub-auth.json`，全部原子写入。

## 开发与测试

```bash
# 校验新版手账面板语法
node --check web/panel-1.8.0.js

# 全部单元测试与 Hub v1.1 本地 mock 集成测试
node --import 'file:///E:/Coopanion/resources/app/node_modules/tsx/dist/loader.mjs' --test test/*.test.mjs

# 核心冒烟回归
node --import 'file:///E:/Coopanion/resources/app/node_modules/tsx/dist/loader.mjs' test/smoke.mjs

# 扩展契约与三同步校验
node --import 'file:///E:/Coopanion/resources/app/node_modules/tsx/dist/loader.mjs' C:\Users\Administrator\.gemini\config\skills\coopani-world-extension\scripts\verify-world.mjs .
```
