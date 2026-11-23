/* Котельная — вкладочный лендинг. Рендер из data.json, без зависимостей. */
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => c === '&' ? '&' : c === '<' ? '<' : c === '>' ? '>' : '');
const nf = n => (n ?? 0).toLocaleString("ru-RU");
const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
const ru = d => { const [y,m,dd] = d.split("-"); return `${dd}.${m}.${y}`; };
const buckets = t => Math.max(2.6 - 0.08 * t, 0.5);
const SET_KEYS = ['heat_run','heat_pause','sup_run','sup_pause_min','fan_run',
                  'fan_pause_min','fan_max_pct','hysteresis'];
const TABS = ['main','fuel','vars','boiler'];
const SAVED = {fuel: [], vars: []};

let DATA = null, selDate = null, TAB = 'main';

/* ─── вкладки до первой загрузки ─── */
function setTab(t) {
  if (!TABS.includes(t)) t = 'main';
  TAB = t;
  document.querySelectorAll('#tabs button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === TAB));
  if (history.replaceState) history.replaceState(null, '', '#' + TAB);
  if (DATA) render();
}
document.getElementById('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (b) setTab(b.dataset.tab);
});
window.addEventListener('hashchange', () => {
  const h = location.hash.replace('#','');
  if (TABS.includes(h) && h !== TAB) setTab(h);
});
if (TABS.includes(location.hash.replace('#',''))) TAB = location.hash.replace('#','');

/* iOS/Safari: при открытии с домашнего экрана возвращался на старую позицию
   скролла — всегда стартуем с верха */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.addEventListener('DOMContentLoaded', () => window.scrollTo(0, 0));

/* ─── загрузка ─── */
fetch("data.json?_=" + Date.now())
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(d => { DATA = d; render(); wireRefresh(); })
  .catch(e => {
    document.getElementById("updated").textContent = "нет данных";
    document.getElementById("content").innerHTML =
      `<div class="card"><div class="note">Не удалось загрузить data.json: ${esc(e.message)}</div></div>`;
  });

/* ─── кнопка «Обновить» справа сверху: свежая погода + пересчёт шкалы бункера ─── */
function wireRefresh() {
  const btn = document.getElementById("refreshBtn");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";
  btn.onclick = async () => {
    toast("Дубль: пересчёт отключён", true); return;
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "…";
    try {
      const r = await fetch("api/rebuild", { method: "POST" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || ("http " + r.status));
      const d = await (await fetch("data.json?_=" + Date.now())).json();
      DATA = d; render();
      toast(j.generated_at ? "Обновлено " + j.generated_at : "Обновлено");
    } catch (e) {
      toast("Не обновилось: " + e.message, true);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  };
}

function render() {
  if (!DATA) return;
  const D = DATA;
  document.getElementById("updated").textContent = "обновлено " + D.generated_at;
  document.querySelectorAll('#tabs button').forEach(b =>
    b.classList.toggle('on', b.dataset.tab === TAB));

  let h = '';
  if (TAB === 'main') h = viewMain(D);
  else if (TAB === 'fuel') h = viewFuel(D);
  else if (TAB === 'vars') h = viewVars(D);
  else h = viewBoiler(D);

  h += `<div class="foot">legagibert.ru/teplo/ · данные из журнала котельной<br>
    расчёт по модели «t° → расход», погода open-meteo ·
    ${D.weather_days.archive} дн. архива + ${D.weather_days.forecast} дн. прогноза</div>`;

  document.getElementById("content").innerHTML = h;

  /* столбики по засыпкам: ширину меряем только что — каждый вьюпорт рисует своё */
  const fr = document.getElementById("fillsroll");
  if (fr) {
    const avail = Math.max(fr.clientWidth, 260);
    fr.innerHTML = svgFills(DATA.fills_bars || [], avail);
    /* засыпки прижаты к ЛЕВОМУ краю, новые появляются правее; если не помещаются — свайп */
    if (fr.scrollWidth > fr.clientWidth) fr.scrollLeft = fr.scrollWidth;
  }

  if (TAB === 'main') buildCalendar();
  if (TAB === 'fuel') wireFuel();
  if (TAB === 'vars') wireVars();
}

/* ═══════════ ВКЛАДКА «ГЛАВНАЯ» ═══════════ */
function viewMain(D) {
  const w = D.weather_today, bunk = D.bunker;
  let h = "";

  /* герой */
  h += `<div class="stats">
    <div class="st"><div class="v">${w ? sign(w[0]) : "—"}°</div>
      <div class="l">на улице<br>Бугачево</div><div class="s">${w ? w[3] : ""}</div></div>
    <div class="st"><div class="v">${D.setpoint ? D.setpoint + "°" : "—"}</div>
      <div class="l">установка<br>контроллера</div>
      <div class="s">гистерезис ${D.settings ? D.settings.hysteresis + "°" : "—"}</div></div>
    <div class="st"><div class="v">${nf(D.reserve_buckets)}</div>
      <div class="l">вёдер угля<br>в запасе</div><div class="s">≈${nf(D.reserve_kg)} кг</div></div>
  </div>`;

  /* бункер + хватит ли */
  h += `<div class="card">`;
  if (bunk) {
    const cap = bunk.capacity || 20;
    const pct = Math.min(100, Math.round(bunk.level_buckets / cap * 100));
    /* пояснения «(было N), залил M» скрыты по его слову 18.10 — только уровень */
    h += `<div class="note"><b>Бункер:</b> ≈${bunk.level_buckets} из ~${cap} вёдер${bunk.estimate ? " (оценка)" : ""}</div>
      <div class="bar"><i style="width:${Math.max(pct,2)}%"></i></div>
      <div class="note">Последняя засыпка ${ru(bunk.last_fill_ts.slice(0,10))} — ${bunk.last_fill_buckets} вёдер.</div>`;
  } else {
    h += `<div class="note"><b>Бункер:</b> заполнен — засыпки записываются во вкладке «Уголь».</div>
      <div class="bar"><i style="width:76%"></i></div>`;
  }
  /* сводка «запас/сожжено» убрана 18.10 (его указ): дней хватает — в «Прогнозе месяца»,
     фактические сжигания — в графике «Расход по засыпкам» */
  h += `</div>`;

  /* модель t° → расход — компактная плита (его решение 18.10: после бункера на Главной) */
  h += `<div class="h2">Модель: температура → расход</div>
    <div class="card">${svgScale(D)}</div>`;

  /* прогноз недели — ОДИН блок (его ТЗ 18.10): температура + расход без слова «вед»,
     число расхода жирное (.fc .b). Итог только в кг/₽. */
  h += `<div class="h2">Прогноз недели</div><div class="card"><div class="fc">`;
  D.forecast7.forEach((f, i) => {
    h += `<div class="${i === 0 ? "now" : ""}" title="${ru(f.date)}">
      <div class="d">${i === 0 ? "сег" : f.dow}</div>
      <div class="t">${sign(Math.round(f.t))}°</div>
      <div class="r">${sign(Math.round(f.tmin))}…${sign(Math.round(f.tmax))}</div>
      <div class="b">${f.buckets}</div>
      <div class="r">${f.kg} кг · ${nf(f.rub)} ₽</div></div>`;
  });
  const t7 = D.forecast7_totals;
  h += `</div><div class="note" style="margin-top:10px">За неделю ≈ ${nf(t7.kg)} кг ≈
    ${nf(t7.rub)} ₽. Среднее за сутки по часам.</div></div>`;

  /* прогноз месяца */
  const M = D.month;
  if (M.days) {
    h += `<div class="h2">Прогноз месяца — расход</div><div class="card">
      <div class="note"><b>${M.days} дней</b> прогноза: <b>${M.buckets} вёдер ≈ ${nf(M.kg)} кг ≈
      ${nf(M.rub)} ₽</b>. Остатка ${nf(D.reserve_kg)} кг хватает на ${D.days_left} дней.</div></div>`;
  }

  /* графики */
  h += `<div class="h2">Расход по засыпкам, вёдер/день</div>
    <div class="card"><div class="hscroll" id="fillsroll"></div></div>`;

  /* архив погоды — календарь на месяц с тапом по дню (его ТЗ 18.10) */
  h += `<div class="h2">Архив погоды — календарь</div>
    <div class="card"><div class="calnav" id="calnav"></div>
    <div class="calgrid" id="cal"></div>
    <div class="daycard" id="daycard"></div></div>`;

  return h;
}

/* ═══════════ ВКЛАДКА «УГОЛЬ» ═══════════ */
function viewFuel(D) {
  const dl = D.delivery;
  const last = dl.items[dl.items.length - 1] || {};
  const names = {delivery:'Приход', fill:'Засыпка', setpoint:'Температура', settings:'Настройки', ash:'Зольник'};
  let h = "";

  /* форма ввода */
  h += `<div class="subh">Внести данные</div>
  <div class="card"><form class="form" id="formFuel">
    <div class="wide"><label for="fill_b">Засыпал в бункер, вёдер</label>
      <input id="fill_b" inputmode="decimal" placeholder="например 12"></div>
    <div class="wide" style="margin-top:4px"><label for="del_kg">Привёз угля, кг</label>
      <input id="del_kg" inputmode="numeric" placeholder="например 3140"></div>
    <div><label for="del_left">Остаток от прошлой партии, вёдер</label>
      <input id="del_left" inputmode="decimal" value="${esc(last.left_buckets ?? '')}"></div>
    <div><label for="del_price">Цена, ₽/т</label>
      <input id="del_price" inputmode="numeric" value="${esc(last.price_t || '')}"></div>
    <div><label for="del_delivery">Доставка, ₽</label>
      <input id="del_delivery" inputmode="numeric" value="${esc(last.delivery || '')}"></div>
    <button type="button" class="btn" id="saveFuel">Сохранить</button>
  </form>
  <div class="note" style="margin-top:9px">Дата и время проставляются сами. Пустые поля не
    отправляются. <b>Остаток писать глазами на глаз</b> — по нему пересчитывается точный
    расход, а не модель.</div>
  </div>`;

  /* история привозов и засыпок — ровно 5 столбцов, строки растут после каждого события
     (его ТЗ 18.10; пункт «точка отсчёта» скрыт — его данные внутренние) */
  h += `<div class="h2">История привозов и засыпок</div><div class="card"><table>
    <tr><th>Дата</th><th>Приход/расход</th><th class="n">Вёдра</th>
        <th class="n">Ср. t°</th><th class="n">В/сут</th></tr>`;
  const HR = D.history_rows || [];
  if (HR.length) {
    HR.slice().reverse().forEach(r => {
      h += `<tr><td>${ru(r.ts.slice(0, 10))}</td>
        <td>${esc(r.kind)}${r.days ? `<br><span style="font-size:11px;color:#8a8a85">${r.days} дн</span>` : ""}</td>
        <td class="n">${r.buckets != null ? `<b>${nf(r.buckets)}</b>` : "—"}</td>
        <td class="n">${r.t_avg != null ? sign(Math.round(r.t_avg * 10) / 10) + "°" : "—"}</td>
        <td class="n">${r.rate != null ? `<b>${r.rate}</b>` : "—"}</td></tr>`;
    });
  } else {
    h += `<tr><td colspan="5" class="note">Записей пока нет</td></tr>`;
  }
  h += `</table></div>`;

  /* история записей */
  h += `<div class="h2">История записей</div><div class="card">`;
  if (D.events && D.events.length) {
    h += `<div class="hist">` + D.events.slice().reverse().map(e =>
      `<div>${esc(ru(e.ts.slice(0, 10)))} ${esc(e.ts.slice(11, 16))} — <b>${names[e.type] || e.type}</b>:
       <b>${esc(prettyVal(e))}</b>${e.src === 'web' ? ' <span style="color:#c2410c">·с сайта</span>' : ""}</div>`
    ).join('');
    h += `</div>`;
  } else {
    h += `<div class="note">Записей пока нет</div>`;
  }
  h += `</div>`;


  /* приход */
  h += `<div class="h2">Приход угля</div><div class="card"><table>
    <tr><th>Дата</th><th class="n">Масса</th><th class="n">Остаток</th><th class="n">Сумма</th></tr>`;
  if (dl.items.length) {
    dl.items.forEach(it => {
      const sum = Math.round(it.kg * it.price_t / 1000 + (it.delivery || 0));
      h += `<tr><td>${ru(it.date)}${it.note ? `<br><span style="font-size:11px;color:#8a8a85">${esc(it.note)}</span>` : ""}</td>
        <td class="n">${nf(it.kg)} кг<br><span style="font-size:11px;color:#8a8a85">≈${nf(Math.round(it.kg / 8))} вёд</span></td>
        <td class="n">${it.left_buckets !== undefined ? nf(it.left_buckets) + " вёд" : "—"}</td>
        <td class="n">${nf(sum)} ₽<br><span style="font-size:11px;color:#8a8a85">+ ${nf(it.delivery || 0)} доставка</span></td></tr>`;
    });
    h += `<tr class="sum"><td>Итого</td><td class="n">${nf(dl.total_kg)} кг</td>
      <td class="n">${D.calibration ? nf(Math.round(D.calibration.delivered_kg / D.calibration.kg_per_bucket_model)) : "—"} вёд по модели</td>
      <td class="n">${nf(dl.paid)} ₽</td></tr>`;
  } else {
    h += `<tr><td colspan="4" class="note">Приходов пока нет</td></tr>`;
  }
  h += `</table><div class="note" style="margin-top:9px">Израсходовано с ${D.burn.since ? ru(D.burn.since) : "начала"}:
    <b>${nf(Math.round(D.burn.kg / 8))} вёдер</b> (${nf(D.burn.kg)} кг) · Средняя цена:
    <b>${nf(dl.avg_price_t)} ₽/т</b></div></div>`;

  /* расходы */
  h += `<div class="h2">Расходы</div><div class="money" style="margin-bottom:12px">
    <div class="mn"><div class="v">${nf(D.oct_rub)} ₽</div><div class="l">октябрь (${nf(D.oct_kg)} кг)</div></div>
    <div class="mn"><div class="v">${nf(D.season_rub)} ₽</div><div class="l">сезон (${nf(D.season_kg)} кг)</div></div>
    <div class="mn"><div class="v">${D.economics.coal_per_kwh} ₽</div><div class="l">уголь за кВт·ч</div></div>
    <div class="mn"><div class="v">${D.economics.electric_per_kwh} ₽</div><div class="l">электричество за кВт·ч</div></div>
  </div>`;

  /* напоминания */
  h += `<div class="h2">Напоминания</div><div class="card">
    <div class="rem"><div class="ic">📱</div><div class="tx">
      <div class="n">Пополнить баланс SIM</div>
      <div class="d">списание 01.11.2026 · тариф «Персональный»</div></div><div class="v">200 ₽</div></div>
    <div class="rem"><div class="ic">⛏️</div><div class="tx">
      <div class="n">Заказать уголь</div>
      <div class="d">при текущем расходе хватит на ${D.days_left} дней</div></div>
      <div class="v">${orderHint(D)}</div></div>
    <div class="rem"><div class="ic">🛢️</div><div class="tx">
      <div class="n">Замена масла в редукторе</div>
      <div class="d">через 100 моточасов или раз в год</div></div><div class="v">проверить</div></div>
  </div>`;

  return h;
}

function prettyVal(e) {
  const v = e.value || {};
  if (e.type === 'delivery') return `${nf(v.kg)} кг${v.left_buckets!==undefined?` · остаток ${nf(v.left_buckets)} вёд`:""} · ${nf(v.price_t)} ₽/т`;
  if (e.type === 'fill') return `${v.buckets} вёдер${v.left_before!==undefined?` (было ${v.left_before})`:''}${v.left_before_pct!==undefined?`, ${v.left_before_pct}% бункера`:''}`;
    if (e.type === 'ash') return `${v.zolnik} зольника золы · сожжено ~${v.buckets} вёдер за ${v.days} дн (${v.zolnik_per_bucket} зольника/ведро)`;
  if (e.type === 'setpoint') return `${v.c}°`;
  if (e.type === 'settings') return SET_KEYS.map(k => v[k] !== undefined ? String(v[k]) : '—').join(' / ');
  return JSON.stringify(v);
}

function orderHint(D) {
  const dt = new Date(); dt.setDate(dt.getDate() + Math.max(D.days_left - 30, 0));
  return "к " + String(dt.getDate()).padStart(2, "0") + "." +
         String(dt.getMonth() + 1).padStart(2, "0");
}

/* ═══════════ ВКЛАДКА «ПЕРЕМЕННЫЕ» ═══════════ */
function viewVars(D) {
  const S = D.settings || {};
  const sp = D.setpoint !== null && D.setpoint !== undefined ? D.setpoint : 45;
  const fields = [
    ['setpoint_c', 'Температура контроллера, °', sp, 45, 60],
    ['heat_run', 'Шнек, нагрев — работа, с', S.heat_run],
    ['heat_pause', 'Шнек, нагрев — перерыв, с', S.heat_pause],
    ['sup_run', 'Шнек, поддержка — работа, с', S.sup_run],
    ['sup_pause_min', 'Шнек, поддержка — перерыв, мин', S.sup_pause_min],
    ['fan_run', 'Вентилятор, поддержка — работа, с', S.fan_run],
    ['fan_pause_min', 'Вентилятор, поддержка — перерыв, мин', S.fan_pause_min],
    ['fan_max_pct', 'Макс. мощность вентилятора, %', S.fan_max_pct],
    ['hysteresis', 'Гистерезис, °', S.hysteresis]
  ];

  let h = `<div class="note" style="margin:12px 2px 10px">Правишь поле — <b>ничего не отправляется</b>,
    пока не нажмёшь <b>«Сохранить»</b> внизу. В полях — текущие значения.</div>
    <div class="card"><form class="form" id="formVars">`;
  fields.forEach(([id, lab, val]) => {
    h += `<div><label for="${id}">${lab}</label>
      <input id="${id}" value="${esc(val ?? '')}" inputmode="decimal"></div>`;
  });
  h += `<button type="button" class="btn" id="saveVars">Сохранить</button></form></div>`;

  /* история изменений */
  const lines = [];
  (D.settings_history || []).forEach(x =>
    lines.push({ts: x.ts, txt: 'настройки: ' + SET_KEYS.map(k => x[k]).join(' / ')}));
  (D.setpoint_history || []).forEach(x =>
    lines.push({ts: x.ts, txt: 'температура ' + x.c + '°'}));
  lines.sort((a, b) => a.ts < b.ts ? 1 : -1);

  h += `<div class="h2">История изменений</div><div class="card">`;
  if (lines.length) {
    h += `<div class="hist">` + lines.map(l =>
      `<div><b>${esc(ru(l.ts.slice(0,10)))}</b> ${esc(l.ts.slice(11,16))} — ${esc(l.txt)}</div>`).join('') +
      `</div><div class="note" style="margin-top:8px">Каждое изменение — отдельная точка в
      статистике: модель считает расход по погоде ДО и ПОСЛЕ правки.</div>`;
  } else {
    h += `<div class="note">Изменений пока не было</div>`;
  }
  h += `</div>`;
  return h;
}

/* ═══════════ ВКЛАДКА «КОТЁЛ» ═══════════ */
function viewBoiler(D) {
  const S = D.settings || {};
  let h = "";

  h += `<div class="h2">Котёл и оборудование</div><div class="equip" style="margin-bottom:12px">
    <div class="eq"><div class="n">ВСКЗ Эко Плюс 20 кВт</div>
      <div class="d">Бункер 300 л · зольник 18 л · 347 кг · КПД 80–90% · дымоход Ø159, ≥3 м · 400 Вт</div></div>
    <div class="eq"><div class="n">DM350</div>
      <div class="d">ДомАвтоматика · реверс шнека · GSM +7 923 280-15-40</div></div>
    <div class="eq"><div class="n">Мотор шнека MY712-4</div>
      <div class="d">0.37 кВт · 1400 об/мин · 2.42 А · IP54 · класс F</div></div>
    <div class="eq"><div class="n">Редуктор MRV</div>
      <div class="d">Масло CLP 220 · первая замена через 100 моточасов, далее раз в год</div></div>
    <div class="eq"><div class="n">Турбина WPA 120</div>
      <div class="d">285 м³/ч · 360 Па · 83 Вт · воздух на розжиг, −25…+40°C</div></div>
    <div class="eq"><div class="n">Стабилизатор IS2000</div>
      <div class="d">Штиль ИнСтаб · 90–310 В · ±2% · 0 мс · байпас</div></div>
  </div>`;

  h += `<div class="h2">Твои текущие настройки</div><div class="card">
    <div class="setrow"><span>Шнек, нагрев</span><b>${S.heat_run} с / ${S.heat_pause} с</b></div>
    <div class="setrow"><span>Шнек, поддержка</span><b>${S.sup_run} с / ${S.sup_pause_min} мин</b></div>
    <div class="setrow"><span>Вентилятор, поддержка</span><b>${S.fan_run} с / ${S.fan_pause_min} мин</b></div>
    <div class="setrow"><span>Макс. мощность вентилятора</span><b>${S.fan_max_pct} %</b></div>
    <div class="setrow"><span>Температура / гистерезис</span><b>${D.setpoint} ° / ${S.hysteresis} °</b></div>
    <div class="note" style="margin-top:8px">Меняются во вкладке «Переменные».</div></div>`;

  h += `<div class="h2">Паспорт котла (справочно)</div>
    <div class="card"><div class="note" style="margin-bottom:9px">Строка 20–34 кВт, уголь —
    усреднённые начальные настройки производителя:</div>
    <table>
    <tr><th></th><th class="n">Подача</th><th class="n">Перерыв</th><th class="n">Вентилятор</th></tr>
    <tr><td>Нагрев</td><td class="n">2–7 с</td><td class="n">20–40 с</td><td class="n">20–40</td></tr>
    <tr><td>Поддержка</td><td class="n">5 с</td><td class="n">10 мин</td><td class="n">продув 10 с</td></tr>
    </table>
    <div style="margin-top:9px"><span class="pill">розжиг в 3 точках</span>
    <span class="pill">без горючих жидкостей</span>
    <span class="pill">отбой света: тление ≥ суток</span>
    <span class="pill">нормальная работа с 30°C</span></div></div>`;

  h += `<div class="h2">Документация</div><div class="docs" style="margin-bottom:6px">
    <a class="doc" href="docs/VSKZ-EKO-Plus_pasport.pdf" target="_blank" rel="noopener">Паспорт ВСКЗ<small>PDF · 467 КБ</small></a>
    <a class="doc" href="docs/DM350_manual.pdf" target="_blank" rel="noopener">Руководство DM350<small>PDF · 2.7 МБ</small></a>
    <a class="doc" href="https://youtu.be/IcDcnDzFJwc" target="_blank" rel="noopener">Настройка ВСКЗ<small>видео</small></a>
  </div>`;

  return h;
}

/* ═══════════ SVG ═══════════ */
/* Один столбик = одна засыпка (дата). Над ним — средний расход периода в вёдрах/день
   (вт — мелко в кг). Закрытые периоды — факт (сплошной), текущий период ещё идёт
   (полупрозрачный). Ширина SVG растёт с числом засыпок, контейнер скроллится свайпом,
   после рендер уводится вправо — новые столбики всегда справа. */
function svgFills(bars, avail) {
  if (!bars || !bars.length) return `<div class="note">Засыпок пока нет</div>`;
  const H = 196, ml = 12, mt = 36, mb = 34;
  const ph = H - mt - mb;
  const n = bars.length;
  /* шаг: тянем под ширину контейнера, но 64…156 px; если при минимуме не влезает —
     SVG шире контейнера, включается свайп (адаптация под вьюпорт) */
  const step = Math.max(64, Math.min(156, Math.floor((avail - 26) / n)));
  const W = ml + n * step + 14;
  const bw = Math.min(step - 26, 44);
  const vmax = Math.max(3, Math.ceil(Math.max(...bars.map(b => b.buckets_day))));
  let s = "";
  for (let k = 0; k <= 3; k++)
    s += `<line x1="${ml - 4}" y1="${mt + ph - k * ph / 3}" x2="${W - 6}" y2="${mt + ph - k * ph / 3}" stroke="#eceae6"/>`;
  s += `<text x="2" y="${mt + 6}" font-size="9" fill="#8a8a85">${vmax.toFixed(0)}</text>`;
  bars.forEach((b, i) => {
    const bh = Math.max(Math.min(b.buckets_day, vmax) / vmax * ph, 3);
    /* ячейка выровнена слева-направо: первый столбик вплотную к левому краю */
    const x = ml + i * step + Math.min((step - bw) / 2, 16), y = mt + ph - bh, cx = x + bw / 2;
    const open = b.state !== "fact";
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="4" fill="#c2410c" opacity="${open ? 0.45 : 0.95}"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${(y - 17).toFixed(1)}" font-size="13" fill="#1a1a1a" text-anchor="middle" font-weight="700">${b.buckets_day}</text>`;
    s += `<text x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="8" fill="#8a8a85" text-anchor="middle">${b.kg_day} кг</text>`;
    s += `<text x="${cx.toFixed(1)}" y="${H - 16}" font-size="9" fill="#5a5a55" text-anchor="middle" font-weight="600">${esc(b.label)}</text>`;
    s += `<text x="${cx.toFixed(1)}" y="${H - 5}" font-size="8" fill="${open ? "#c2410c" : "#8a8a85"}" text-anchor="middle">${open ? b.days + " дн · идёт" : b.days + " дн"}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}px">${s}</svg>`;
}

/* Модель «t° → расход» — ОДНА шкала с показаниями (его ТЗ 18.10: огромный график убран).
   На шкале: числа вёдер и его наблюдения 2024 (5° 2.2 · 0° 2.6 · −15° 4.0 · −30° 5.0),
   стрелка и число сверху — текущее показание: среднесуточная t° → 2.6 − 0.08·t. */
/* Модель в компактном виде (его слово 18.10: «ужасно громоздко — переделай или скрой»):
   один ряд слева направо: показание −2° → 2.77, справа тонкая шкала с одним маркером.
   Подписей, тиков и точек наблюдений больше НЕТ — числа сами по себе говорят. */
function svgScale(D) {
  const w = D.weather_today;
  const t = w ? w[0] : null;
  const val = t === null ? null : Math.max(0.5, 2.6 - 0.08 * t);
  const vmin = 1.6, vmax = 5.8, W = 388, H = 46;
  const x0 = 96, x1 = W - 8, yBar = 24, bh = 9;
  const X = v => x0 + (Math.min(Math.max(v, vmin), vmax) - vmin) / (vmax - vmin) * (x1 - x0);
  let s = `<defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#f7ddc9"/><stop offset="1" stop-color="#c2410c"/></linearGradient></defs>`;
  s += `<text x="8" y="${yBar + 4}" font-size="16" font-weight="700" fill="#1a1a1a">${sign(Math.round(t))}°</text>`;
  if (val !== null) {
    s += `<text x="36" y="${yBar + 4}" font-size="16" font-weight="700" fill="#c2410c">${Math.round(val * 100) / 100}</text>`;
    s += `<rect x="${x0}" y="${yBar}" width="${x1 - x0}" height="${bh}" rx="4.5" fill="url(#mg)"/>`;
    const x = X(val);
    s += `<rect x="${(x - 1.5).toFixed(1)}" y="${yBar - 7}" width="3" height="${bh + 14}" rx="1.5" fill="#1a1a1a"/>`;
  }
  /* на широких экранах НЕ раздувать: шкала обязана оставаться одним компактным рядом */
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto">${s}</svg>`;
}

/* ═══════════ архив погоды — КАЛЕНДАРЬ (его ТЗ 18.10) ═══════════
   Месяц сеткой, тап по дню → температура этого дня + расход в вёдрах.
   Факт (`daily_fact`, дни между засыпками) — точное число; иначе модель (~). */
let calMonth = null;   /* 'YYYY-MM' */

function shiftMonth(dir) {
  const [y, m] = calMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + dir, 1);
  calMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  buildCalendar();
}

function monthName(m) {
  return ["январь","февраль","март","апрель","май","июнь","июль",
          "август","сентябрь","октябрь","ноябрь","декабрь"][m - 1];
}

function buildCalendar() {
  const box = document.getElementById("cal");
  const nav = document.getElementById("calnav");
  if (!box || !nav || !DATA) return;
  if (!selDate || !DATA.weather[selDate]) selDate = DATA.today;
  if (!calMonth) calMonth = DATA.today.slice(0, 7);
  const range = DATA.weather_range || [DATA.today, DATA.today];
  const lo = range[0].slice(0, 7), hi = range[1].slice(0, 7);
  if (calMonth < lo) calMonth = lo;
  if (calMonth > hi) calMonth = hi;

  const [y, m] = calMonth.split("-").map(Number);
  nav.innerHTML = `<button id="calPrev" ${calMonth <= lo ? "disabled" : ""}>‹</button>
    <span class="m">${monthName(m)} ${y}</span>
    <button id="calNext" ${calMonth >= hi ? "disabled" : ""}>›</button>`;
  const pb = document.getElementById("calPrev"), nb = document.getElementById("calNext");
  if (pb) pb.onclick = () => shiftMonth(-1);
  if (nb) nb.onclick = () => shiftMonth(1);

  const first = new Date(y, m - 1, 1);
  const startIdx = (first.getDay() + 6) % 7;   /* пн = 0 */
  const daysIn = new Date(y, m, 0).getDate();
  let cells = ["пн","вт","ср","чт","пт","сб","вс"]
    .map(d => `<div class="cdow">${d}</div>`).join("");
  for (let i = 0; i < startIdx; i++) cells += `<span></span>`;
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const w = DATA.weather[iso];
    const fact = (DATA.daily_fact || {})[iso];
    const val = fact !== undefined ? Math.round(fact * 10) / 10
              : (w ? Math.round(buckets(w[0]) * 10) / 10 : null);
    const cls = "cd" + (iso === selDate ? " on" : "") + (iso > DATA.today ? " fut" : "");
    cells += `<button data-d="${iso}" class="${cls}"${w ? "" : " disabled"}>${d}` +
             (val != null ? `<i>${val}</i>` : "") + `</button>`;
  }
  box.innerHTML = cells;
  box.querySelectorAll("button.cd").forEach(b =>
    b.onclick = () => { selDate = b.dataset.d; buildCalendar(); });
  renderDay();
}

function renderDay() {
  const el = document.getElementById("daycard");
  if (!el) return;
  const w = DATA.weather[selDate];
  if (!w) { el.innerHTML = `<div class="sub">Нет данных за ${ru(selDate)}</div>`; return; }
  const [mean, mn, mx, src] = w;
  const b = buckets(mean);
  const dow = ["вс","пн","вт","ср","чт","пт","сб"][new Date(selDate + "T12:00").getDay()];
  const future = selDate > DATA.today;
  const fact = (DATA.daily_fact || {})[selDate];
  /* факт (дни между засыпками) — точное число, модель — с «~» */
  const burn = fact !== undefined
    ? `<b style="color:#1a1a1a">${Math.round(fact * 10) / 10}</b> ведра`
    : `~<b style="color:#1a1a1a">${Math.round(b * 10) / 10}</b> ведра`;
  el.innerHTML = `
    <div class="big">${sign(Math.round(mean * 10) / 10)}°</div>
    <div class="sub">${dow}, ${ru(selDate)} · ночь ${sign(Math.round(mn))}° / день ${sign(Math.round(mx))}° · ${src}${future ? " (прогноз)" : ""}</div>
    <div class="sub" style="margin-top:7px">расход: ${burn} (${Math.round((fact !== undefined ? fact : b) * 8)} кг)</div>`;
}

/* ═══════════ сохранение (общий механизм, кнопка = явное действие) ═══════════ */
function wireFuel() {
  markSaved('fuel');
  const btn = document.getElementById("saveFuel");
  if (!btn) return;
  btn.onclick = () => {
    const fill = num("fill_b");
    const kg = num("del_kg"), left = num("del_left");
    const price = num("del_price"), deliv = num("del_delivery");
    const p = {};
    if (fill !== null && fill > 0) {
      p.fill = {buckets: fill};
    }
    if (kg || left !== null) {
      p.delivery = {kg: kg || null, price_t: price || 0, delivery: deliv || 0};
      if (left !== null && left >= 0) p.delivery.left_buckets = left;
      if (!kg) delete p.delivery;   /* остаток без самого привоза не пишем */
    }
    if (!Object.keys(p).length) { toast("Заполни хотя бы одно поле", true); return; }
    SAVED.fuel = [];
    if (fill !== null && fill > 0) SAVED.fuel.push("fill_b");
    if (kg) SAVED.fuel.push("del_kg", "del_left", "del_price", "del_delivery");
    doSave(btn, p);
  };
}

function wireVars() {
  markSaved('vars');
  const btn = document.getElementById("saveVars");
  if (!btn) return;
  btn.onclick = () => {
    const sp = num("setpoint_c");
    const p = {}, settings = {};
    if (sp !== null) p.setpoint = {c: sp};
    SET_KEYS.forEach(k => { const v = num(k); if (v !== null) settings[k] = v; });
    if (Object.keys(settings).length) p.settings = settings;
    if (!Object.keys(p).length) { toast("Нечего сохранять", true); return; }
    SAVED.vars = [];
    if (sp !== null) SAVED.vars.push("setpoint_c");
    SET_KEYS.forEach(k => { if (num(k) !== null) SAVED.vars.push(k); });
    doSave(btn, p);
  };
}

async function doSave(btn, payload) {
  toast("Дубль: запись отключена", true); return;
  btn.disabled = true; btn.textContent = "Сохраняю…";
  try {
    const r = await fetch("api/save", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || ("HTTP " + r.status));
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    toast("Сохранено, " + hhmm + (out.saved ? " · " + out.saved.join(", ") : ""));
    const d = await (await fetch("data.json?_=" + Date.now())).json();
    DATA = d;
    render();                       // перерисовать; метки восстановит wireX()
    btn.disabled = false; btn.textContent = "Сохранить";
  } catch (e) {
    toast("Ошибка: " + e.message + " — значения не потеряны", true);
    btn.disabled = false; btn.textContent = "Сохранить";
  }
}

function num(id) {
  const e = document.getElementById(id);
  if (!e) return null;
  const v = e.value.trim();
  if (v === "") return null;
  const x = parseFloat(v.replace(",", "."));
  return isNaN(x) ? null : x;
}

function markSaved(kind) {
  (SAVED[kind] || []).forEach(id => {
    const e = document.getElementById(id);
    if (e) e.classList.add("saved");
  });
}

function toast(msg, isErr) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  t.style.display = "block";
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.display = "none"; }, 3400);
}