/**
 * 台灣麻將台數判讀 + 加總(純邏輯,零相依)
 *
 * 吃一段文字(可來自語音辨識或手動),對照 fan_table.json,
 * 輸出命中的台種、總台數,以及需人工確認的警告。
 *
 * 設計原則:
 *  - 不做任何 I/O、不綁 UI、不綁 APP,瀏覽器與 Node 皆可用。
 *  - 判讀結果一律回傳結構化物件,給「確認關卡」UI 顯示,不直接送出。
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MahjongTai = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CN_NUM = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

  /** 把 fan_table 的所有詞(name/aliases/asr_confusions)攤平成 詞→fanId 的比對表。 */
  function buildIndex(table) {
    var terms = [];
    table.fans.forEach(function (fan) {
      var words = [fan.name]
        .concat(fan.aliases || [])
        .concat(fan.asr_confusions || []);
      words.forEach(function (w) {
        terms.push({ term: w, id: fan.id });
      });
    });
    // 長詞優先,避免「門清」先吃掉「門清自摸」
    terms.sort(function (a, b) { return b.term.length - a.term.length; });
    var byId = {};
    table.fans.forEach(function (f) { byId[f.id] = f; });
    return { terms: terms, byId: byId };
  }

  /**
   * 解析詞前面的數量詞(如「三張花」「兩朵」),回傳 { qty, start }。
   * start = 數量詞前綴的起始位置(呼叫端據此標記 consumed);無數量詞則 start=pos。
   * 關鍵:前導字必須「未被其他台種吃掉」才算數,避免從相鄰台種尾巴偷數字
   *       (如「大四花」不可把『大四喜』的『四』讀成 4 張花)。
   */
  function readQuantity(text, pos, consumed) {
    var i = pos - 1;
    var hasMeasure = (i >= 0 && !consumed[i] && '張朵個支'.indexOf(text[i]) !== -1);
    var numIdx = hasMeasure ? i - 1 : i;
    if (numIdx >= 0 && !consumed[numIdx]) {
      var ch = text[numIdx];
      var n = CN_NUM[ch] || ((ch >= '0' && ch <= '9') ? parseInt(ch, 10) : 0);
      if (n) return { qty: n, start: numIdx };
    }
    return { qty: 1, start: pos };
  }

  /**
   * 台數公式的唯一來源:per_unit 台種 = tai × units + tai_base;一般台種 = tai。
   * tai_base 承載「連莊 2N+1」家規裡的 +1(即莊家台,故 lianzhuang excludes zhuang)。
   * 🔴 demo.html 的 ± 步進與手動補台也必須走這支,不可各自乘 —— 自己乘會漏掉 tai_base。
   */
  function fanTai(fan, units) {
    var u = fan.per_unit ? (units || 1) : 1;
    return fan.tai * u + (fan.tai_base || 0);
  }

  /**
   * 主判讀函式。
   * @param {string} text  辨識或輸入的文字,如 "門清 正花 獨聽" 或 "門清正花三張花"
   * @param {object} table fan_table.json 物件
   * @param {object} [config] 覆寫 table.config
   * @returns {{hits:Array, total:number, warnings:Array, unmatched:string}}
   */
  var MAX_LEN = 200; // 語音一句遠短於此;超過視為異常輸入,截斷防拖慢

  function parse(text, table, config) {
    if (!text) return { hits: [], total: 0, warnings: [], unmatched: '' };
    var lenWarn = null;
    if (text.length > MAX_LEN) {
      lenWarn = { level: 'too_long', message: '輸入過長(' + text.length + '字),已截斷至前 ' + MAX_LEN + ' 字' };
      text = text.slice(0, MAX_LEN);
    }
    var cfg = Object.assign({}, table.config || {}, config || {});
    var idx = buildIndex(table);
    var consumed = new Array(text.length).fill(false);
    var raw = {}; // id -> { count, matchedTerms:Set }

    // 由左至右、長詞優先掃描
    for (var pos = 0; pos < text.length; pos++) {
      if (consumed[pos]) continue;
      for (var t = 0; t < idx.terms.length; t++) {
        var term = idx.terms[t].term;
        if (text.substr(pos, term.length) !== term) continue;
        var overlap = false;
        for (var k = pos; k < pos + term.length; k++) if (consumed[k]) { overlap = true; break; }
        if (overlap) continue;

        var fan = idx.byId[idx.terms[t].id];
        var qty = 1;
        if (fan.per_unit) {
          var q = readQuantity(text, pos, consumed);
          qty = q.qty;
          for (var qi = q.start; qi < pos; qi++) consumed[qi] = true; // 把數量詞前綴也標為已消耗
        }
        if (!raw[fan.id]) raw[fan.id] = { count: 0, matchedTerms: [] };
        raw[fan.id].count += qty;
        if (raw[fan.id].matchedTerms.indexOf(term) === -1) raw[fan.id].matchedTerms.push(term);

        for (var m = pos; m < pos + term.length; m++) consumed[m] = true;
        pos += term.length - 1;
        break;
      }
    }

    // 組成候選命中
    var candidates = Object.keys(raw).map(function (id) {
      var fan = idx.byId[id];
      var units = fan.per_unit ? raw[id].count : 1;
      return {
        id: id,
        name: fan.name,
        tai: fanTai(fan, units),
        unitTai: fan.tai,
        units: units,
        category: fan.category,
        matchedTerms: raw[id].matchedTerms,
        _fan: fan
      };
    });

    var warnings = [];
    if (lenWarn) warnings.push(lenWarn);

    // 互斥解析:兩個互斥台種同時命中,保留台數高者,低者剔除並警告
    var dropped = {};
    candidates.forEach(function (a) {
      var ex = a._fan.excludes || [];
      ex.forEach(function (bid) {
        var b = candidates.find(function (c) { return c.id === bid; });
        if (!b || dropped[a.id] || dropped[b.id]) return;
        var loser = a.tai >= b.tai ? b : a;
        var keeper = loser === a ? b : a;
        dropped[loser.id] = true;
        warnings.push({
          level: 'exclude',
          message: loser.name + ' 與 ' + keeper.name + ' 互斥,已保留 ' + keeper.name + '(' + keeper.tai + '台)'
        });
      });
    });

    var hits = candidates.filter(function (c) { return !dropped[c.id]; });

    // 矛盾偵測:自摸類台種(含依定義即自摸者)與「必須胡別人」台種不可並存
    var selfDrawFans = hits.filter(function (h) {
      return h.id === 'zimo' || h._fan.requires_self_draw;
    });
    var discardFans = hits.filter(function (h) { return h._fan.requires_discard; });
    if (selfDrawFans.length && discardFans.length) {
      warnings.push({
        level: 'conflict',
        message: selfDrawFans[0].name + '(自摸)與 ' + discardFans[0].name + '(胡別人)矛盾,請確認胡牌方式'
      });
    }

    var total = hits.reduce(function (s, h) { return s + h.tai; }, 0);
    if (cfg.base_di) total += cfg.base_di;

    // 未被吃掉的殘字(可能是沒收錄的詞或誤聽),回報給確認 UI
    var unmatched = '';
    for (var u = 0; u < text.length; u++) if (!consumed[u] && text[u].trim()) unmatched += text[u];

    // 清掉內部欄位
    hits.forEach(function (h) { delete h._fan; });

    return {
      hits: hits,
      total: total,
      base: cfg.base_di || 0,
      warnings: warnings,
      unmatched: unmatched.replace(/\s+/g, '')
    };
  }

  return { parse: parse, buildIndex: buildIndex, fanTai: fanTai };
});
