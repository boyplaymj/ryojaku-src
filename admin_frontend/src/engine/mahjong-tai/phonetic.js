/*
 * phonetic.js — 音近比對前處理層(Stage A / ①)+ 組合語展開
 *
 * 問題:瀏覽器內建 ASR 是通用中文聽寫,對麻將術語會用常用詞「腦補改寫」
 *       (門清→門青、獨聽→讀聽、大四喜→大思喜),字錯但「音」通常對。
 * 解法:不信任「字」,只信任「音」。把 ASR 生文字與台種詞庫都轉成無聲調拼音,
 *       用詞級容錯比對,校正回正規台種名。
 *
 * 每個「詞條」可展開成一到多個台種、且各自帶次數:expand = [{id, count}]。
 *   - 單一台種同義詞:一摸 → [{id:自摸, count:1}]
 *   - 組合語(連報):一摸三 → [{門清,1},{自摸,1},{不求人,1}];雙二花 → [{正花,2}]
 *
 * 依賴:pinyin-pro(vendor/pinyin-pro.js,全域 window.pinyinPro)
 * 匯出:window.MahjongPhonetic = { buildIndex(table, combos), normalize(rawText) }
 */
(function (global) {
  var PY_OPT = { toneType: 'none', type: 'array', nonZh: 'consecutive' };
  var CN_DIGIT = { '0':'〇','1':'一','2':'二','3':'三','4':'四','5':'五','6':'六','7':'七','8':'八','9':'九' };

  // 阿拉伯數字→中文,讓「雙2花 / 一摸3」和「雙二花 / 一摸三」拼音一致
  function digitsToCn(s) { return (s || '').replace(/[0-9]/g, function (d) { return CN_DIGIT[d]; }); }

  function toPinyin(text) {
    if (!global.pinyinPro || !text) return [];
    return global.pinyinPro.pinyin(digitsToCn(text), PY_OPT)
      .map(function (s) { return (s || '').toLowerCase().trim(); })
      .filter(function (s) { return /[a-z]/.test(s); });
  }

  // 台灣國語音變正規化:平舌翹舌不分 zh/ch/sh→z/c/s;前後鼻音不分 -eng/-ing→-en/-in
  function canon(s) {
    return s.replace(/^zh/, 'z').replace(/^ch/, 'c').replace(/^sh/, 's')
            .replace(/eng$/, 'en').replace(/ing$/, 'in');
  }

  // 音節相似度:完全相同=1;台灣音變同形=0.9(強命中);僅差一字元=0.5;否則 0
  function syl(a, b) {
    if (a === b) return 1;
    if (canon(a) === canon(b)) return 0.9;
    if (lev(a, b) === 1) return 0.5;
    return 0;
  }

  function lev(a, b) {
    var m = a.length, n = b.length;
    if (Math.abs(m - n) > 1) return 2;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  var INDEX = [];    // [{ expand:[{id,count}], surface, py, n, combo }]
  var ID_NAME = {};  // id → 台種名(供 normalizedText/顯示)

  function addSurface(expand, surface, isCombo, seen, ignore) {
    var py = toPinyin(surface);
    if (!py.length) return;
    var key = py.join(' ');
    if (seen[key]) return;
    seen[key] = 1;
    INDEX.push({ expand: expand, surface: surface, py: py, n: py.length, combo: !!isCombo, ignore: !!ignore });
  }

  /*
   * buildIndex(table, combos, ignores)
   *   table.fans:[{id, name, aliases?, asr_confusions?}]  單一台種同義詞
   *   combos:[{surfaces:[...], expand:[{id,count}]}]       組合語(可選)
   *   ignores:[片語,...]  略過詞(認得但計 0 台,如莊/連二拉二,後台自動算,避免重複計台)
   */
  function buildIndex(table, combos, ignores) {
    INDEX = []; ID_NAME = {};
    var fans = (table && table.fans) || [];
    fans.forEach(function (f) {
      ID_NAME[f.id] = f.name;
      var seen = {};
      var surfaces = [f.name].concat(f.aliases || []).concat(f.asr_confusions || []);
      surfaces.forEach(function (s) { addSurface([{ id: f.id, count: 1 }], s, false, seen); });
    });
    (combos || []).forEach(function (c) {
      if (!c || !c.expand || !c.expand.length) return;
      var seen = {};
      (c.surfaces || []).forEach(function (s) { addSurface(c.expand, s, true, seen); });
    });
    var seenIg = {};
    (ignores || []).forEach(function (s) { addSurface([], s, false, seenIg, true); });
    INDEX.sort(function (a, b) { return b.n - a.n; }); // 長詞優先,組合語/略過長句自然贏過其中的單詞
    return INDEX.length;
  }

  function scoreAt(entry, rawPy, pos) {
    if (pos + entry.n > rawPy.length) return 0;
    var strong = 0, sum = 0;
    for (var k = 0; k < entry.n; k++) {
      var s = syl(entry.py[k], rawPy[pos + k]);
      if (s >= 0.9) strong++;
      sum += s;
    }
    var avg = sum / entry.n;
    if (entry.n === 1) return strong === 1 ? avg : 0;
    if (avg >= 0.75 && strong >= Math.ceil(entry.n / 2)) return avg;
    return 0;
  }

  /*
   * normalize(rawText) → {
   *   counts: {id: count}         各台種累計次數(拿去跟後台交叉核對的鑰匙)
   *   matched: [{surface, score, expand:[{id,count,name}]}]  逐段命中(含組合語)
   *   normalizedText: 展開後的台種名(依次數重複、空白分隔,可餵 scoring.parse)
   *   leftover, rawPinyin
   * }
   */
  function normalize(rawText) {
    var rawPy = toPinyin(rawText);
    var rawCn = digitsToCn(rawText);
    var used = new Array(rawPy.length).fill(false);
    var matched = [];
    var pos = 0;
    while (pos < rawPy.length) {
      if (used[pos]) { pos++; continue; }
      var best = null;
      for (var i = 0; i < INDEX.length; i++) {
        var e = INDEX[i];
        var free = true;
        for (var k = 0; k < e.n && pos + k < rawPy.length; k++) { if (used[pos + k]) { free = false; break; } }
        if (!free) continue;
        // 單音節詞太容易同音誤判(花/話/化),要求原文真的出現該字才採計
        if (e.n === 1 && rawCn.indexOf(e.surface) < 0) continue;
        var sc = scoreAt(e, rawPy, pos);
        // 覆蓋率加權:比的是 分數×音節數,不是分數。
        // 只比分數的話,「短的精確命中」會贏過「長的容錯命中」——
        // 例:ASR 把「大三元」聽成「拉三元」,拉三(精確 1.0)會搶走 大三元(容錯 0.833),
        // 8 台變 7 台。加權後 0.833×3=2.5 > 1.0×2=2.0,長詞守得住。
        // (2026-09-01 實測:159 個台種詞零回歸;反控見 phonetic.test.js D1-9)
        var w = sc * e.n;
        if (sc > 0 && (!best || w > best.w || (w === best.w && e.n > best.e.n))) best = { e: e, sc: sc, w: w };
      }
      if (best) {
        for (var j = 0; j < best.e.n; j++) used[pos + j] = true;
        matched.push({
          surface: best.e.surface,
          score: Math.round(best.sc * 100) / 100,
          combo: best.e.combo,
          ignore: best.e.ignore,
          expand: best.e.expand.map(function (x) { return { id: x.id, count: x.count, name: ID_NAME[x.id] || x.id }; })
        });
        pos += best.e.n;
      } else { pos++; }
    }
    var counts = {}, nameSeq = [], ignored = [];
    matched.forEach(function (m) {
      if (m.ignore) { ignored.push(m.surface); return; } // 略過詞:認得但不計台(後台自動算)
      m.expand.forEach(function (x) {
        counts[x.id] = (counts[x.id] || 0) + x.count;
        for (var t = 0; t < x.count; t++) nameSeq.push(x.name);
      });
    });
    return {
      counts: counts,
      matched: matched,
      ignored: ignored,
      normalizedText: nameSeq.join(' '),
      leftover: rawPy.filter(function (_, i) { return !used[i]; }).join(' '),
      rawPinyin: rawPy.join(' ')
    };
  }

  global.MahjongPhonetic = { buildIndex: buildIndex, normalize: normalize, _toPinyin: toPinyin };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.MahjongPhonetic;
}
