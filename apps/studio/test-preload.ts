/**
 * `bun test` 预加载（见 bunfig.toml）：把数据目录指向临时目录。
 *
 * db/index.ts 在 **import 阶段**就会打开 SQLite 并执行迁移，而 gateway /
 * knowledge / rpc 等模块在 import 期就会读表。若不做隔离，单独跑某个测试文件
 * （或将来换成进程隔离的 runner）会直接打开并迁移开发者/用户真实的
 * `~/Library/Application Support/omni-studio/…/omni-studio.db`。
 *
 * 需要自己造库的测试仍可覆盖 OMNI_DATA_DIR / OMNI_DB_PATH（它们用 mkdtemp 自建）。
 */
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dir = mkdtempSync(join(tmpdir(), `omni-test-${process.pid}-`));
process.env.OMNI_DATA_DIR = dir;
process.env.OMNI_DB_PATH = join(dir, "omni-studio.db");
// agent 工作区同样要隔离：不指走的话 getAgentWorkspace() 落到用户真实的
// ~/.omnistudio/workspace，每条 agent 用例的回合快照都会对它跑 `git add -A`
//（几千个文件时一条用例就要好几秒，5s 的测试上限直接被吃光），测试还会读到
// 用户自己的文件。OMNI_AGENT_WORKSPACE 的消费端在 agent.ts 的 getAgentWorkspace()。
process.env.OMNI_AGENT_WORKSPACE = join(dir, "agent-workspace");
process.env.NODE_ENV = "test";
