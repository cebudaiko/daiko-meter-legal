import { escapeHtml } from '../utils/html.js';

function yen(value) {
  const number = Number(value);
  const integer = Number.isFinite(number) ? Math.trunc(number) : 0;
  return `¥${integer.toLocaleString('ja-JP')}`;
}

function nonNegativeIntegerYen(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function feeRow(label, value, modifier = '') {
  return `<div class="receipt-fee-row ${escapeHtml(modifier)}">
    <dt>${escapeHtml(label)}</dt><dd>${escapeHtml(yen(value))}</dd>
  </div>`;
}

function surchargeRows(labels, percentFee, fixedFee, totalFee) {
  const hasBreakdown = percentFee > 0 || fixedFee > 0;
  if (totalFee <= 0 && !hasBreakdown) return '';
  return [
    feeRow(labels.total, totalFee, `is-surcharge-total receipt-surcharge-group${hasBreakdown ? ' has-breakdown' : ''}`),
    percentFee > 0 ? feeRow(labels.percent, percentFee, 'is-subordinate receipt-surcharge-breakdown') : '',
    fixedFee > 0 ? feeRow(labels.fixed, fixedFee, 'is-subordinate receipt-surcharge-breakdown') : '',
  ].join('');
}

function legalRow(label, value) {
  if (!value) return '';
  return `<div class="receipt-issuer-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function tripFactRow(label, value) {
  return `<div class="receipt-trip-detail"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

/**
 * Builds receipt document markup. App callers get the complete receipt by default;
 * public QR delivery explicitly disables trip data and the in-app QR issuance stamp.
 */
export function receiptMarkup(model = {}, { includeTripDetails = true, includeQr = true } = {}) {
  const issuer = model.issuer && typeof model.issuer === 'object' ? model.issuer : {};
  const options = Array.isArray(model.optionDetails) ? model.optionDetails : [];
  const addressee = model.addressee
    ? `<p class="receipt-addressee"><span>${escapeHtml(model.addressee)}</span> 様</p>`
    : '';
  const issueText = model.issuedDateTime || model.issuedDate;
  const issuedDate = issueText ? `<p class="receipt-issued-date">発行日時　${escapeHtml(issueText)}</p>` : '';
  const issuerName = issuer.name ? `<p class="receipt-issuer-name">${escapeHtml(issuer.name)}</p>` : '';
  const note = model.note ? `<p class="receipt-note">但し　${escapeHtml(model.note)}</p>` : '';
  const trip = [model.companyName, model.carNumber].filter(Boolean).map(escapeHtml).join(' ・ ');
  const route = includeTripDetails && model.routeText
    ? `<div class="receipt-trip-route"><dt>経路</dt><dd>${escapeHtml(model.routeText)}</dd></div>` : '';
  const optionRows = options.map((option) => feeRow(option?.label || '', option?.amount)).join('');
  const daySurchargePercentFee = nonNegativeIntegerYen(model.daySurchargePercentFee);
  const daySurchargeFixedFee = nonNegativeIntegerYen(model.daySurchargeFixedFee);
  const daySurchargeFee = nonNegativeIntegerYen(model.daySurchargeFee);
  const winterSurchargePercentFee = nonNegativeIntegerYen(model.winterSurchargePercentFee);
  const winterSurchargeFixedFee = nonNegativeIntegerYen(model.winterSurchargeFixedFee);
  const winterSurchargeFee = nonNegativeIntegerYen(model.winterSurchargeFee);
  const tripDetails = includeTripDetails ? `<dl class="receipt-trip-details" aria-label="走行明細">
      ${tripFactRow('走行距離', model.distanceText || '0.0 km')}
      ${tripFactRow('実車時間', model.serviceDurationText || '00:00:00')}
      ${tripFactRow('待機時間', model.waitDurationText || '00:00:00')}
    </dl>
    ${route}
    ${trip ? `<p class="receipt-trip-reference">走行記録　${trip}</p>` : ''}` : '';
  const qr = includeQr ? `<section class="receipt-qr" aria-label="領収証をQRで受け取る">
      <canvas data-receipt-qr-canvas width="256" height="256" aria-label="領収証受取QRコード"></canvas>
      <div><strong>読み取って領収証を保存</strong><span>宛名・走行情報は含まれません</span></div>
    </section>` : '';

  return `<article class="receipt-document" aria-label="領収証">
    <header class="receipt-document-header">
      <div><p class="receipt-kicker">DRIVING SERVICE RECEIPT</p><h1>領収証</h1></div>
      ${issuedDate}
    </header>
    ${addressee}
    <section class="receipt-total" aria-label="領収金額"><span>領収金額</span><strong>${escapeHtml(yen(model.totalFare))}</strong><small>税込</small></section>
    ${note}
    <dl class="receipt-fees" aria-label="料金内訳">
      ${feeRow('基本料金', model.baseFare)}
      ${surchargeRows({ total: '日中割増計', percent: 'うち 日中率割増', fixed: 'うち 日中固定加算' }, daySurchargePercentFee, daySurchargeFixedFee, daySurchargeFee)}
      ${surchargeRows({ total: '冬期割増計', percent: 'うち 冬期率割増', fixed: 'うち 冬期固定加算' }, winterSurchargePercentFee, winterSurchargeFixedFee, winterSurchargeFee)}
      ${feeRow('時間料金', model.timeFee)}
      ${feeRow('待機料金', model.waitFee)}
      ${feeRow('オプション料金', model.optionFee)}
      ${optionRows}
      ${feeRow('合計', model.totalFare, 'is-total')}
    </dl>
    ${tripDetails}
    <footer class="receipt-document-footer">
      <section class="receipt-issuer" aria-label="発行者">
        ${issuerName}
        <dl>${legalRow('登録番号', issuer.registrationNumber)}${legalRow('所在地', issuer.address)}${legalRow('電話', issuer.phone)}</dl>
      </section>
      <p class="receipt-number"><span>RECEIPT NO.</span><strong>${escapeHtml(model.receiptNumber || '')}</strong></p>
    </footer>
    ${qr}
  </article>`;
}
