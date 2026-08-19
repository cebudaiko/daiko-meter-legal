import { emptyRateCandidate, validateRateCandidate } from './rate-candidate.js';

const MIN_DEFAULT_CONFIDENCE = 70;

const FLAT = /([0-9]+(?:\.[0-9]+)?)\s*km\s*まで\s*([0-9]+)\s*円/i;
const PER_KM = /(?:以降\s*)?(?:1\s*)?km\s*(?:ごと|につき)?\s*([0-9]+)\s*円/i;
const TIME = /([0-9]+(?:\.[0-9]+)?)\s*km\/h\s*以下.*?([0-9]+)\s*秒\s*ごと\s*([0-9]+)\s*円/i;
const WAIT = /待機.*?([0-9]+)\s*分\s*まで\s*([0-9]+)\s*円.*?(?:以降\s*)?([0-9]+)\s*分\s*ごと\s*([0-9]+)\s*円/i;
const DAY_HOURS = /日中\s*([0-9]+(?:\.[0-9]+)?)\s*時\s*[〜~ー\-]\s*([0-9]+(?:\.[0-9]+)?)\s*時/i;
const UNSUPPORTED = /(?:オプション|キャンセル|保険|追加料金|延長料金|特別(?:期間|料金)?|年末年始|割増|サーチャージ|割引|クーポン)/i;
const HEADING_FAMILY_TOKENS = Object.freeze({
  day: Object.freeze(['日中', '昼間', '昼']),
  night: Object.freeze(['深夜', '夜間', '夜', '通常']),
});
const HEADING_PRICE_TOKENS = Object.freeze(['料金', '運賃', '価格']);

function alternation(tokens) {
  return tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}

const DAY_HEADING_SOURCE = alternation(HEADING_FAMILY_TOKENS.day);
const NIGHT_HEADING_SOURCE = alternation(HEADING_FAMILY_TOKENS.night);
const PRICE_HEADING_SOURCE = alternation(HEADING_PRICE_TOKENS);
const SEMANTIC_HEADING_SOURCE = [DAY_HEADING_SOURCE, NIGHT_HEADING_SOURCE, PRICE_HEADING_SOURCE].join('|');
const EXACT_DAY_HEADING = new RegExp(`^(?:${DAY_HEADING_SOURCE})\\s*(?:${PRICE_HEADING_SOURCE})?$`, 'u');
const EXACT_NIGHT_HEADING = new RegExp(`^(?:${NIGHT_HEADING_SOURCE})\\s*(?:${PRICE_HEADING_SOURCE})?$`, 'u');
const DAY_HEADING_TOKEN = new RegExp(`(?:${DAY_HEADING_SOURCE})`, 'u');
const NIGHT_HEADING_TOKEN = new RegExp(`(?:${NIGHT_HEADING_SOURCE})`, 'u');
const PRICE_HEADING_TOKEN = new RegExp(`^(?:${PRICE_HEADING_SOURCE})$`, 'u');
const LEADING_LIST_ORDINAL = /^(?:(?:[0-9]{1,2}\s*[.)、:\-])|(?:\([0-9]{1,2}\)))\s*/u;
const KNOWN_RATE_SYNTAX_TOKENS = [
  'まで', 'ごと', '以下',
  'オプション', 'キャンセル', '保険', '追加料金', '延長料金', '特別',
  '年末年始', '割増', 'サーチャージ', '割引', 'クーポン',
].map((token) => ({
  token,
  spaced: new RegExp([...token].join('\\s*'), 'g'),
}));
const KNOWN_HEADING_SYNTAX_TOKENS = [
  ...HEADING_FAMILY_TOKENS.day,
  ...HEADING_FAMILY_TOKENS.night,
  ...HEADING_PRICE_TOKENS,
].map((token) => ({
  token,
  spaced: new RegExp([...token].join('\\s*'), 'g'),
}));

function numericConfidence(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function normalizeLine(value) {
  let text = String(value ?? '').normalize('NFKC');
  text = text
    .replace(/[，,]/g, '')
    .replace(/キロ/gi, 'km')
    .replace(/迄/g, 'まで')
    .replace(/[～〜]/g, '〜')
    .replace(/[−―—–]/g, '-')
    .replace(/[¥￥]\s*([0-9]+)/g, '$1円')
    .replace(/([0-9]+)\s*[¥￥]/g, '$1円')
    .replace(/[\t\u00a0\u3000 ]+/g, ' ')
    .trim();
  return text;
}

function normalizeRateSyntax(value) {
  let text = normalizeLine(value);
  for (const { token, spaced } of KNOWN_RATE_SYNTAX_TOKENS) {
    text = text.replace(spaced, token);
  }
  return text;
}

function normalizeHeadingSyntax(value) {
  let text = normalizeLine(value);
  for (const { token, spaced } of KNOWN_HEADING_SYNTAX_TOKENS) {
    text = text.replace(spaced, token);
  }
  return text.replace(/[:：]\s*$/, '').trim();
}

function stripLeadingListOrdinal(value) {
  return value.replace(LEADING_LIST_ORDINAL, '').trimStart();
}

function flattenBlocks(blocks) {
  const found = [];
  const stack = Array.isArray(blocks) ? [...blocks] : [];
  const seen = new Set();
  while (stack.length) {
    const block = stack.shift();
    if (!block || typeof block !== 'object' || seen.has(block)) continue;
    seen.add(block);
    if (typeof block.text === 'string' && block.text.trim()) found.push(block);
    for (const key of ['blocks', 'paragraphs', 'lines', 'words']) {
      if (Array.isArray(block[key])) stack.push(...block[key]);
    }
  }
  return found;
}

function blockConfidenceForLine(line, blocks, fallback) {
  const normalized = normalizeLine(line);
  const exact = blocks.find((block) => normalizeLine(block.text) === normalized);
  const containing = exact || blocks.find((block) => normalizeLine(block.text).includes(normalized));
  return containing
    ? numericConfidence(containing.confidence, fallback)
    : fallback;
}

function parserIssue(code, message, field, sourceText, severity = 'error') {
  return {
    code,
    message,
    ...(field ? { field } : {}),
    ...(sourceText ? { sourceText } : {}),
    severity,
  };
}

function markField(candidate, name, matches, resultConfidence, blocks, selectable = true) {
  if (!matches.length) return;
  const confidences = matches.map(({ source }) => (
    blockConfidenceForLine(source, blocks, resultConfidence)
  ));
  const confidence = Math.min(...confidences);
  candidate.fields[name] = {
    confidence,
    sourceText: matches.map(({ source }) => source).join('\n'),
    selected: selectable && confidence >= MIN_DEFAULT_CONFIDENCE,
  };
  if (confidence < MIN_DEFAULT_CONFIDENCE) {
    candidate.issues.push(parserIssue(
      'OCR_LOW_CONFIDENCE',
      'OCR信頼度が70未満のため要確認です。初期選択を解除しました。',
      name,
      candidate.fields[name].sourceText,
      'warning',
    ));
  }
}

function headingKind(line) {
  const normalized = stripLeadingListOrdinal(normalizeHeadingSyntax(line));
  if (EXACT_NIGHT_HEADING.test(normalized)) return 'night';
  if (EXACT_DAY_HEADING.test(normalized)) return 'day';
  return null;
}

function headingCue(line, rateSyntax) {
  const kind = headingKind(line);
  if (kind) return { kind, hint: kind };
  const normalized = normalizeLine(line);
  if (
    DAY_HOURS.test(rateSyntax)
    || UNSUPPORTED.test(rateSyntax)
    || (/(?:運転代行|代行)$/.test(normalized) && !/[0-9]+\s*円/.test(normalized))
  ) return null;

  const syntax = stripLeadingListOrdinal(normalizeHeadingSyntax(line));
  const semanticTokens = [...syntax.matchAll(new RegExp(`(?:${SEMANTIC_HEADING_SOURCE})`, 'gu'))];
  const hasPriceCue = semanticTokens.some((match) => PRICE_HEADING_TOKEN.test(match[0]));
  if (!semanticTokens.length || !hasPriceCue) return null;
  const first = semanticTokens[0];
  const last = semanticTokens.at(-1);
  const prefix = syntax.slice(0, first.index);
  const suffix = syntax.slice(last.index + last[0].length);
  const residue = syntax.replace(new RegExp(`(?:${SEMANTIC_HEADING_SOURCE})`, 'gu'), '');
  const day = DAY_HEADING_TOKEN.test(syntax);
  const night = NIGHT_HEADING_TOKEN.test(syntax);
  if (!day && !night) return null;
  const hint = day === night ? null : (day ? 'day' : 'night');
  if (/[0-9]/.test(syntax)) return { kind: null, hint, unresolved: true };
  if (
    !/^[\p{P}\p{S}\s]*$/u.test(prefix)
    || !/^[\p{P}\p{S}\s]*$/u.test(suffix)
  ) return { kind: null, hint, unresolved: true };
  if (!/^[\p{Script=Hiragana}\p{P}\p{S}\s]*$/u.test(residue)) {
    return { kind: null, hint, unresolved: true };
  }
  const uncertain = /[?？]/.test(syntax);
  return { kind: hint && !uncertain ? hint : null, hint };
}

function rateBandAt(index, headingCues) {
  if (headingCues.length === 0) return { kind: 'night', hint: 'night' };
  let band = { kind: null, hint: null };
  for (const heading of headingCues) {
    if (heading.index >= index) break;
    band = { kind: heading.kind, hint: heading.hint };
  }
  return band;
}

function rateFieldFor(band) {
  return (band.kind || band.hint) === 'day' ? 'dayRows' : 'nightRows';
}

function resolveSingleton(candidate, name, matches, code, message) {
  if (!matches.length) return;
  const distinct = new Map(matches.map((match) => [JSON.stringify(match.value), match.value]));
  if (distinct.size === 1) {
    candidate.values[name] = matches[0].value;
    return;
  }
  candidate.issues.push(parserIssue(
    code,
    message,
    name,
    matches.map(({ source }) => source).join('\n'),
  ));
}

export function parseRateOcrResult({ text = '', blocks = [], confidence = 0 } = {}) {
  const candidate = emptyRateCandidate();
  const resultConfidence = numericConfidence(confidence);
  const confidenceBlocks = flattenBlocks(blocks);
  const rawLines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lines = rawLines.map((source, index) => ({
    source,
    normalized: normalizeLine(source),
    rateSyntax: normalizeRateSyntax(source),
    index,
  }));
  const headingCues = lines
    .map((line) => ({
      index: line.index,
      ...headingCue(line.normalized, line.rateSyntax),
    }))
    .filter((heading) => Object.hasOwn(heading, 'kind'));

  const matches = Object.fromEntries([
    'companyName', 'nightRows', 'dayRows', 'timeFare', 'waitFare', 'dayHours',
  ].map((name) => [name, []]));

  for (const line of lines) {
    const {
      source, normalized, rateSyntax, index,
    } = line;
    const cue = headingCue(normalized, rateSyntax);
    if (cue?.kind) continue;

    if (UNSUPPORTED.test(rateSyntax)) {
      candidate.issues.push(parserIssue(
        'UNSUPPORTED_RATE_TEXT',
        'オプション・特別期間・割増・割引は写真取り込み対象外です。',
        undefined,
        source,
      ));
      continue;
    }

    if (/(?:運転代行|代行)$/.test(normalized) && !/[0-9]+\s*円/.test(normalized)) {
      matches.companyName.push({ source, normalized });
      continue;
    }

    const time = TIME.exec(rateSyntax);
    if (time) {
      matches.timeFare.push({
        source,
        normalized,
        value: {
          enabled: true,
          speedThresholdKmh: time[1],
          intervalSec: time[2],
          feePerInterval: time[3],
        },
      });
      continue;
    }

    const wait = WAIT.exec(rateSyntax);
    if (wait) {
      matches.waitFare.push({
        source,
        normalized,
        value: {
          initialMinutes: wait[1],
          initialFee: wait[2],
          additionalInterval: wait[3],
          additionalFee: wait[4],
        },
      });
      continue;
    }

    const dayHours = DAY_HOURS.exec(rateSyntax);
    if (dayHours) {
      matches.dayHours.push({
        source,
        normalized,
        value: { start: dayHours[1], end: dayHours[2] },
      });
      continue;
    }

    if (cue) {
      const fieldName = rateFieldFor(cue);
      matches[fieldName].push({ source, normalized });
      candidate.issues.push(parserIssue(
        cue.unresolved ? 'UNRESOLVED_RATE_HEADING' : 'UNASSIGNED_RATE_ROW',
        cue.unresolved
          ? '料金見出しの意味を安全に判定できないため要確認です。'
          : '日中・夜間の見出しを一意に判定できないため要確認です。',
        fieldName,
        source,
      ));
      continue;
    }

    if (/km/i.test(rateSyntax) && /円/.test(rateSyntax)) {
      const band = rateBandAt(index, headingCues);
      const fieldName = rateFieldFor(band);
      const yenCount = rateSyntax.match(/円/g)?.length ?? 0;
      const flat = yenCount === 1 ? FLAT.exec(rateSyntax) : null;
      const perKm = yenCount === 1 ? PER_KM.exec(rateSyntax) : null;
      if (!band.kind || (!flat && !perKm)) {
        matches[fieldName].push({ source, normalized });
        candidate.issues.push(parserIssue(
          band.kind ? 'AMBIGUOUS_RATE_ROW' : 'UNASSIGNED_RATE_ROW',
          band.kind
            ? '距離と金額の対応を一意に判定できないため要確認です。'
            : '日中・夜間の見出しを判定できないため要確認です。',
          fieldName,
          source,
        ));
        continue;
      }

      candidate.values[fieldName].push(flat
        ? { upToKm: flat[1], kind: 'flat', amount: flat[2] }
        : { upToKm: '', kind: 'perKm', amount: perKm[1] });
      matches[fieldName].push({ source, normalized });
    }
  }

  if (matches.companyName.length === 1) {
    candidate.values.companyName = matches.companyName[0].normalized;
  } else if (matches.companyName.length > 1) {
    candidate.issues.push(parserIssue(
      'AMBIGUOUS_COMPANY_NAME',
      '会社名の候補が複数あるため要確認です。',
      'companyName',
      matches.companyName.map(({ source }) => source).join('\n'),
    ));
  }

  resolveSingleton(
    candidate,
    'timeFare',
    matches.timeFare,
    'CONFLICTING_TIME_FARE',
    '低速時間料金の候補が一致しないため要確認です。',
  );
  resolveSingleton(
    candidate,
    'waitFare',
    matches.waitFare,
    'CONFLICTING_WAIT_FARE',
    '待機料金の候補が一致しないため要確認です。',
  );
  resolveSingleton(
    candidate,
    'dayHours',
    matches.dayHours,
    'CONFLICTING_DAY_HOURS',
    '日中時間の候補が一致しないため要確認です。',
  );

  for (const name of Object.keys(matches)) {
    const ambiguous = candidate.issues.some((entry) => (
      entry.field === name && (
        ['AMBIGUOUS_RATE_ROW', 'UNASSIGNED_RATE_ROW', 'AMBIGUOUS_COMPANY_NAME'].includes(entry.code)
        || entry.code.startsWith('CONFLICTING_')
      )
    ));
    markField(candidate, name, matches[name], resultConfidence, confidenceBlocks, !ambiguous);
  }

  const validation = validateRateCandidate(candidate);
  candidate.issues = validation.issues;
  for (const entry of validation.issues) {
    if (entry.severity !== 'warning' && candidate.fields[entry.field]) {
      candidate.fields[entry.field].selected = false;
    }
  }

  return candidate;
}
