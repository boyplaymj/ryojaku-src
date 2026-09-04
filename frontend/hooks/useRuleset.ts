// hooks/useRuleset.ts — 取家規台數表（D5-d）
//
// 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §5c。
// 🔴 這一層**只有接線**：選哪一份、驗不驗得過、404 該不該清快取，
//    全部在 utils/rulesetSource.ts（那裡有測試；hooks/ 不在 run-tests.mjs 的 glob 裡）。
//    這裡多寫一行判斷，就是多一份沒有測試的判準。
//
// ── 三個刻意的行為 ────────────────────────────────────────────────
//
// 🔴 ① 開頁當下**同步**就有一張表可用（快取或 bundle），不等網路。
//    等網路的話，斷線時這一頁會空著 —— 而 bundle 裡本來就有一份完整的表。
//
// 🔴 ② `frozen` 為真時**不換表**。使用者手上已經有選取或辨識結果時把表換掉，
//    合計台數會在他沒碰任何東西的情況下改變 —— 那是最不該發生的一種畫面
//    （這一頁存在的理由就是「讓他確認那個數字」）。
//    換好的那一份會等到他按重置／下一局再生效，不會丟掉。
//
// 🔴 ③ 一次進頁只抓一次。抓到的寫進快取，**下一次進頁**就一定吃得到，
//    即使這一次因為 frozen 沒有套用。

import { useEffect, useMemo, useRef, useState } from 'react';
import { getRuleset } from '../services/apiService';
import {
  applyFetch,
  classifyRulesetResponse,
  clearCache,
  pickRuleset,
  readCache,
  writeCache,
  type RemoteRuleset,
  type RulesetPick,
} from '../utils/rulesetSource';
import type { AsrFanTable } from '../utils/voiceTaiAsr';

/** localStorage 拿不到就回 null（SSR／無痕／被政策關掉）—— 全程不拋。 */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function useRuleset(bundle: AsrFanTable, frozen: boolean): RulesetPick {
  const [remote, setRemote] = useState<RemoteRuleset | null>(null);
  // 快取只在掛載時讀一次。之後它只會被這支自己改（404 清掉），
  // 每次 render 重讀的話，別的分頁改了 localStorage 會讓表在使用者手上跳動。
  const [cached, setCached] = useState<RemoteRuleset | null>(() => readCache(safeStorage()));

  const pending = useMemo(
    () => pickRuleset({ bundle, remote, cached }),
    [bundle, remote, cached],
  );
  const [applied, setApplied] = useState<RulesetPick>(pending);

  useEffect(() => {
    if (frozen) return;
    // 同一份就不要換 —— pickRuleset 每次都回新物件，換上去會讓
    // voiceTaiAsr 的 ensureIndex 以為換了表而重建索引。
    setApplied((prev) => (prev.table === pending.table && prev.version === pending.version ? prev : pending));
  }, [pending, frozen]);

  const startedRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    // ⚠️ StrictMode 下 effect 會跑兩次。startedRef 擋住第二次的請求，
    //    而 aliveRef 在第二次 render 時被重新設回 true ——
    //    否則第一次的 cleanup 會把還在飛的那次結果丟掉，
    //    開發模式下就變成「永遠抓不到遠端表」，而正式版是好的。
    if (!startedRef.current) {
      startedRef.current = true;
      void getRuleset()
        .then((res) => {
          if (!aliveRef.current) return;
          // 🔴 這裡只搬結論，不做判斷。「404 清快取、502 不清」那條判準
          //    整條在 applyFetch()（utils/，有測試）—— 在這裡重寫一次
          //    就是多一份沒有守衛的判準。
          const out = applyFetch(classifyRulesetResponse(res));
          if (out.store && out.remote) writeCache(safeStorage(), out.remote);
          if (out.remote) setRemote(out.remote);
          if (out.dropCache) {
            clearCache(safeStorage());
            setCached(null);
          }
          if (out.note) console.warn('[voice-tai]', out.note);
        })
        .catch((err) => {
          // getRuleset 自己已經 fail-open（apiRequest 會把例外收成 success:false），
          // 走到這裡代表呼叫端寫錯了。一樣不擋使用者，但要留痕。
          console.warn('[voice-tai] /ruleset 呼叫本身出錯:', err);
        });
    }
    return () => {
      aliveRef.current = false;
    };
  }, []);

  return applied;
}
