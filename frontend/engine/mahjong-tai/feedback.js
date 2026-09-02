/**
 * 糾正回饋 — 資料飛輪的核心(純邏輯,零相依,存儲無關)
 *
 * 流程:確認關卡使用者改錯 → recordCorrection 記成結構化 log
 *      → extractSuggestions 找出高頻糾正 → applySuggestion 回灌對照表 → 下次更準
 *
 * 存儲交給呼叫端(瀏覽器 localStorage / Node 檔案 / DynamoDB 皆可),本模組只處理資料。
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MahjongFeedback = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_TERM_LEN = 8; // 麻將台種名最長約 4~5 字;超過視為雜訊,不當新詞

  /**
   * 詞正規化:去零寬/控制字元、去標點與空白、NFKC 正規化。
   * unmatched 殘字與 known terms 都走同一套,避免「爭花。」「爭花​」繞過去重。
   */
  function normalizeTerm(s) {
    // 先 NFKC(全形→半形等),再白名單只留漢字與英數;標點/空白/零寬/控制/符號一律去除。
    // 白名單比黑名單穩:不必窮舉所有符號,任何非漢字非英數都清掉。
    return (s || '')
      .normalize('NFKC')
      .replace(/[^㐀-䶿一-鿿0-9A-Za-z]/g, '')
      .trim();
  }

  /**
   * 把「一次糾正」正規化成 log 紀錄。
   * @param {object} input
   *   text      {string}   原始辨識/輸入文字
   *   parsed    {string[]} 系統判出的 fanId(來自 scoring.parse 的 hits.map(id))
   *   corrected {string[]} 使用者確認後的正解 fanId
   *   unmatched {string}   parse 回報的殘字(沒對到任何台種的片段)
   *   ts        {number}   時間戳(呼叫端提供,本模組不取系統時間)
   * @returns {object} 正規化紀錄,含 added / removed 差異
   */
  function recordCorrection(input) {
    var parsed = input.parsed || [];
    var corrected = input.corrected || [];
    var ps = new Set(parsed), cs = new Set(corrected);
    var added = corrected.filter(function (id) { return !ps.has(id); });   // 使用者補上的(parse 漏了)
    var removed = parsed.filter(function (id) { return !cs.has(id); });     // 使用者刪掉的(parse 判錯)
    return {
      ts: input.ts || 0,
      text: input.text || '',
      userId: input.userId || null, // 有帶時用於「不同使用者」門檻,防單人灌爆
      unmatched: (input.unmatched || '').replace(/\s+/g, ''),
      parsed: parsed.slice(),
      corrected: corrected.slice(),
      added: added,
      removed: removed
    };
  }

  /** 蒐集對照表裡所有已知詞(正規化後),用來判斷某糾正是否為「新詞」。 */
  function knownTerms(table) {
    var s = new Set();
    table.fans.forEach(function (f) {
      s.add(normalizeTerm(f.name));
      (f.aliases || []).forEach(function (w) { s.add(normalizeTerm(w)); });
      (f.asr_confusions || []).forEach(function (w) { s.add(normalizeTerm(w)); });
    });
    return s;
  }

  /**
   * 從 log 找出值得回灌的建議。
   * @param {object[]} records recordCorrection 產出的紀錄陣列
   * @param {object} table     fan_table 物件
   * @param {object} [opts]    { minCount:2 } 同一糾正累積幾次才升級(防單人口誤污染)
   * @returns {object[]} 建議清單,依信心/次數排序
   */
  function extractSuggestions(records, table, opts) {
    var minCount = (opts && opts.minCount) || 2;
    var known = knownTerms(table);

    // 型一(高信心):殘字 → 應對到某台種 = 缺一個誤聽/同義詞
    var addConf = {};
    // 型二(需人工複核):某台種常被改成另一台種 = 共用的糾錯詞可能指錯家
    var remap = {};

    records.forEach(function (r) {
      if (r.unmatched && r.added.length === 1) {
        var term = normalizeTerm(r.unmatched);
        if (term && term.length <= MAX_TERM_LEN && !known.has(term)) {
          var k = term + '' + r.added[0];
          (addConf[k] = addConf[k] || { type: 'add_confusion', term: term, fanId: r.added[0], count: 0, users: new Set(), examples: [] });
          addConf[k].count++;
          if (r.userId) addConf[k].users.add(r.userId);
          if (addConf[k].examples.length < 3) addConf[k].examples.push(r.text);
        }
      }
      if (!r.unmatched && r.removed.length === 1 && r.added.length === 1) {
        var k2 = r.removed[0] + '' + r.added[0];
        (remap[k2] = remap[k2] || { type: 'review_mapping', fromFanId: r.removed[0], toFanId: r.added[0], count: 0, users: new Set(), examples: [] });
        remap[k2].count++;
        if (r.userId) remap[k2].users.add(r.userId);
        if (remap[k2].examples.length < 3) remap[k2].examples.push(r.text);
      }
    });

    // 有帶 userId 時,門檻改看「不同使用者數」;完全沒帶時退回筆數(向後相容)
    function passes(e) {
      var effective = e.users.size > 0 ? e.users.size : e.count;
      e.distinctUsers = e.users.size;
      delete e.users;
      return effective >= minCount;
    }
    var out = [];
    Object.keys(addConf).forEach(function (k) { if (passes(addConf[k])) out.push(addConf[k]); });
    Object.keys(remap).forEach(function (k) { if (passes(remap[k])) out.push(remap[k]); });
    out.sort(function (a, b) { return b.count - a.count; });
    return out;
  }

  /**
   * 把一則 add_confusion 建議套進對照表(回傳同一個 table,已就地加入詞)。
   * review_mapping 型不自動套用(需人工判斷),回傳 false。
   */
  function applySuggestion(table, suggestion) {
    if (suggestion.type !== 'add_confusion') return false;
    var term = normalizeTerm(suggestion.term);
    if (!term || term.length > MAX_TERM_LEN) return false;
    var fan = table.fans.find(function (f) { return f.id === suggestion.fanId; });
    if (!fan) return false;
    // 全表去重:正規化後只要任何台種已收錄就不再加,避免污染
    if (knownTerms(table).has(term)) return false;
    fan.asr_confusions = fan.asr_confusions || [];
    fan.asr_confusions.push(term);
    return true;
  }

  return {
    recordCorrection: recordCorrection,
    extractSuggestions: extractSuggestions,
    applySuggestion: applySuggestion,
    knownTerms: knownTerms,
    normalizeTerm: normalizeTerm
  };
});
