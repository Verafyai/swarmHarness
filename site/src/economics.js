// Page logic for /economics. The economics functions are inlined above this by site/build.py.
(function () {
  var GROUPS = [
    ['Machine', ['gpuHourUsd', 'cpuHourUsd', 'utilizationPct', 'warmupMinutes']],
    ['Proof', ['proverBatch', 'proverBatchSeconds', 'contextTokens', 'proofMB', 'verifySeconds']],
    ['Jury and block', ['jurors', 'verifiersPerProof', 'contracts', 'tokensPerContract']],
    ['Proof packing', ['packing', 'proveOnce', 'decisionsPerRequest', 'briefMaxTokens', 'answerTokensPerDecision', 'headerTokens', 'fidelityCheckUsd']],
    ['Storage and margin', ['storageUsdPerGBMonth', 'retentionMonths', 'marginPct']],
  ]
  var NAMES = {
    gpuHourUsd: 'GPU, $ per hour', cpuHourUsd: 'Verifier CPU box, $ per hour', utilizationPct: 'GPU utilization, %', warmupMinutes: 'Warm-up per session, minutes',
    proverBatch: 'Requests per prover batch', proverBatchSeconds: 'Seconds per batch', contextTokens: 'Tokens per proven request', proofMB: 'Proof size, MB', verifySeconds: 'Verify time, seconds',
    jurors: 'Jurors per jury', verifiersPerProof: 'Verifiers per proof', contracts: 'Contracts in the block', tokensPerContract: 'Tokens per contract',
    packing: 'Proof packing (briefs)', proveOnce: 'Prove once, verify many', decisionsPerRequest: 'Decisions per request', briefMaxTokens: 'Brief budget, tokens', answerTokensPerDecision: 'Answer tokens per decision', headerTokens: 'Header tokens', fidelityCheckUsd: 'Fidelity check per brief, $',
    storageUsdPerGBMonth: 'Storage, $ per GB-month', retentionMonths: 'Retention, months', marginPct: 'Operator margin, %',
  }
  var TAGCLS = { 'vendor-reported': 'vr', measured: 'm', modeled: 'mo' }
  var form = document.getElementById('inputs')
  var state = inputs({})

  function money(x) { return '$' + (Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(4)) }
  function num(x, d) { return Number(x).toLocaleString('en-US', { maximumFractionDigits: d === undefined ? 1 : d }) }
  function dur(s) { return s >= 3600 ? num(s / 3600, 1) + ' h' : num(s / 60, 1) + ' min' }

  function build() {
    GROUPS.forEach(function (g) {
      var fs = document.createElement('fieldset')
      fs.innerHTML = '<legend>' + g[0] + '</legend>'
      g[1].forEach(function (k) {
        var d = DEFAULTS[k], row = document.createElement('label')
        row.className = 'in'
        var tag = '<span class="tag ' + (TAGCLS[d.label] || '') + '" title="' + d.source.replace(/"/g, '&quot;') + '">' + d.label + '</span>'
        if (typeof d.value === 'boolean') {
          row.innerHTML = '<span class="nm">' + NAMES[k] + ' ' + tag + '</span><input type="checkbox" name="' + k + '">'
        } else {
          row.innerHTML = '<span class="nm">' + NAMES[k] + ' ' + tag + '</span><input type="number" step="any" min="0" name="' + k + '">'
        }
        fs.appendChild(row)
      })
      form.appendChild(fs)
    })
    form.addEventListener('input', read)
  }

  function fill() {
    Object.keys(NAMES).forEach(function (k) {
      var el = form.elements[k]
      if (!el) return
      if (el.type === 'checkbox') el.checked = !!state[k]
      else el.value = +Number(state[k]).toPrecision(6)
    })
  }

  function read() {
    Object.keys(NAMES).forEach(function (k) {
      var el = form.elements[k]
      if (!el) return
      if (el.type === 'checkbox') state[k] = el.checked
      else if (el.value !== '' && isFinite(+el.value) && +el.value > 0) state[k] = +el.value
    })
    render(); save()
  }

  function save() {
    var diff = {}, base = inputs({})
    Object.keys(NAMES).forEach(function (k) { if (state[k] !== base[k]) diff[k] = state[k] })
    var q = Object.keys(diff).length ? '?s=' + encodeURIComponent(JSON.stringify(diff)) : ''
    try { history.replaceState(null, '', location.pathname + q + location.hash) } catch (e) {}
  }

  function load() {
    try {
      var s = new URLSearchParams(location.search).get('s')
      if (s) state = inputs(JSON.parse(s))
    } catch (e) {}
  }

  function out(name, text) {
    document.querySelectorAll('[data-out="' + name + '"]').forEach(function (n) { n.textContent = text })
  }

  function render() {
    var e = estimate(state)
    var u = estimate(Object.assign({}, state, { packing: false, proveOnce: false }))
    var p = estimate(Object.assign({}, state, { packing: true, proveOnce: true }))
    document.getElementById('mode').textContent = state.packing ? (state.proveOnce ? 'packed, proved once' : 'packed') : (state.proveOnce ? 'unpacked, proved once' : 'unpacked')
    out('blockCostUsd', money(e.blockCostUsd))
    out('perContractUsd', money(e.perContractUsd))
    out('priceWithMarginUsd', money(e.priceWithMarginUsd))
    out('perDecisionUsd', money(e.perDecisionUsd))
    out('requestsInBlock', num(e.requestsInBlock, 0))
    out('proofsLine', e.provers + ' prover' + (e.provers > 1 ? 's' : '') + ', ' + num(e.proofs, 0) + ' proofs, ' + num(e.verifications, 0) + ' verifications')
    out('sealLine', dur(e.sealSeconds) + ' (provers work in parallel)')
    out('proofGB', num(e.proofGB, 2) + ' GB, in the availability layer, never on chain')
    out('capacityPerHour', num(e.capacityPerHour, 0))
    out('breakEvenFeePerProof', money(e.breakEvenFeePerProof) + ' at ' + num(state.utilizationPct, 0) + '% utilization')
    out('minWarmLine', num(e.minRequestsForWarmup, 0) + ' requests per prover' + (state.packing ? ', about ' + num(e.minDecisionsForWarmup, 0) + ' decisions' : ''))
    out('proveUsd', money(e.proveUsd))
    out('warmShare', num(100 * u.parts.warmup / u.blockCostUsd, 0) + '%')
    out('packGain', num(u.perDecisionUsd / p.perDecisionUsd, 0) + 'x')

    var w = document.getElementById('fitWarn')
    if (state.packing && !e.packingFits) { w.hidden = false; w.textContent = 'This packing does not fit: ' + num(e.packedTokens, 0) + ' tokens per request against a limit of ' + num(state.contextTokens, 0) + '. Lower the decisions per request or the brief budget.' }
    else w.hidden = true

    var COLORS = { proving: 'var(--accent)', verifying: 'var(--allow)', storing: 'var(--mute)', warmup: 'var(--hold)', fidelity: '#8A5CC7' }
    var LABELS = { proving: 'Proving', verifying: 'Verifying', storing: 'Storing proofs', warmup: 'Warm-up', fidelity: 'Brief fidelity checks' }
    var bar = '', leg = ''
    Object.keys(e.parts).forEach(function (k) {
      var v = e.parts[k]; if (v <= 0) return
      var pct = 100 * v / e.blockCostUsd
      bar += '<span style="width:' + pct + '%;background:' + COLORS[k] + '" title="' + LABELS[k] + '"></span>'
      leg += '<li><i style="background:' + COLORS[k] + '"></i>' + LABELS[k] + ' ' + money(v) + ' (' + num(pct, 0) + '%)</li>'
    })
    document.getElementById('bar').innerHTML = bar
    document.getElementById('legend').innerHTML = leg

    var rows = [
      ['Proven requests', num(u.requestsInBlock, 0), num(p.requestsInBlock, 0)],
      ['Provers', u.provers, p.provers],
      ['Proofs', num(u.proofs, 0), num(p.proofs, 0)],
      ['Proof data', num(u.proofGB, 2) + ' GB', num(p.proofGB, 2) + ' GB'],
      ['Warm-up', money(u.parts.warmup), money(p.parts.warmup)],
      ['Fidelity checks', money(u.parts.fidelity), money(p.parts.fidelity)],
      ['Block cost', money(u.blockCostUsd), money(p.blockCostUsd)],
      ['Per contract', money(u.perContractUsd), money(p.perContractUsd)],
      ['Per decision, before warm-up', money(u.perDecisionUsd), money(p.perDecisionUsd)],
      ['Time to seal', dur(u.sealSeconds), dur(p.sealSeconds)],
    ]
    document.getElementById('compare').innerHTML = rows.map(function (r) { return '<tr><td class="k">' + r[0] + '</td><td class="v">' + r[1] + '</td><td class="v">' + r[2] + '</td></tr>' }).join('')

    var R = e.roles
    document.getElementById('roles').innerHTML =
      '<tr><td>Proving operator</td><td class="v">' + money(R.prover.feePerProof) + ' per proof</td><td class="v">' + money(R.prover.revenuePerHour) + '</td><td class="v">' + money(R.prover.costPerHour) + '</td><td class="v ' + (R.prover.netPerHour < 0 ? 'neg' : 'pos') + '">' + money(R.prover.netPerHour) + '</td><td class="v">' + money(R.prover.blockRevenue) + '</td></tr>' +
      '<tr><td>Verifier</td><td class="v">' + money(R.verifier.feePerVerification) + ' per check</td><td class="v">' + money(R.verifier.revenuePerHour) + '</td><td class="v">' + money(R.verifier.costPerHour) + '</td><td class="v ' + (R.verifier.netPerHour < 0 ? 'neg' : 'pos') + '">' + money(R.verifier.netPerHour) + '</td><td class="v">' + money(R.verifier.blockRevenue) + '</td></tr>' +
      '<tr><td colspan="6" class="k">Break-even GPU utilization for the proving operator at this margin: ' + num(R.prover.breakEvenUtilizationPct, 0) + '%. Below it the GPU rent outruns the fees.</td></tr>'

    chart(state)
  }

  function chart(s) {
    var sizes = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160, 200]
    var a = curve(Object.assign({}, s, { packing: false, proveOnce: false }), sizes)
    var b = curve(Object.assign({}, s, { packing: true, proveOnce: true }), sizes)
    var W = 760, H = 300, L = 70, B = 40, T = 16, Rr = 16
    var ymax = Math.max.apply(null, a.concat(b).map(function (p) { return p.perContractUsd }))
    var lg = function (n) { return Math.log(n) / Math.log(200) }
    var X = function (n) { return L + lg(n) * (W - L - Rr) }
    var Y = function (v) { return H - B - (v / ymax) * (H - B - T) }
    var path = function (pts) { return pts.map(function (p, k) { return (k ? 'L' : 'M') + X(p.contracts).toFixed(1) + ' ' + Y(p.perContractUsd).toFixed(1) }).join(' ') }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" font-family="JetBrains Mono, monospace" font-size="12">'
    for (var g = 0; g <= 4; g++) { var v = ymax * g / 4, y = Y(v); svg += '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y + '" y2="' + y + '" stroke="var(--rule)"/><text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end" fill="var(--mute)">' + money(v) + '</text>' }
    ;[1, 4, 12, 24, 48, 96, 200].forEach(function (n) { svg += '<text x="' + X(n) + '" y="' + (H - B + 18) + '" text-anchor="middle" fill="var(--mute)">' + n + '</text>' })
    svg += '<text x="' + ((W + L) / 2) + '" y="' + (H - 4) + '" text-anchor="middle" fill="var(--mute)">contracts in the block (log scale)</text>'
    svg += '<path d="' + path(a) + '" fill="none" stroke="var(--hold)" stroke-width="2.5"/>'
    svg += '<path d="' + path(b) + '" fill="none" stroke="var(--accent)" stroke-width="2.5"/>'
    var n = Math.min(200, Math.max(1, s.contracts))
    var cu = estimate(Object.assign({}, s, { packing: false, proveOnce: false })).perContractUsd
    var cp = estimate(Object.assign({}, s, { packing: true, proveOnce: true })).perContractUsd
    svg += '<line x1="' + X(n) + '" x2="' + X(n) + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--ink)" stroke-dasharray="3 4"/>'
    svg += '<circle cx="' + X(n) + '" cy="' + Y(cu) + '" r="5" fill="var(--hold)"/><circle cx="' + X(n) + '" cy="' + Y(cp) + '" r="5" fill="var(--accent)"/>'
    svg += '<rect x="' + (W - 230) + '" y="' + T + '" width="214" height="48" fill="var(--sheet)" stroke="var(--rule)"/>'
    svg += '<line x1="' + (W - 220) + '" x2="' + (W - 196) + '" y1="' + (T + 16) + '" y2="' + (T + 16) + '" stroke="var(--hold)" stroke-width="2.5"/><text x="' + (W - 188) + '" y="' + (T + 20) + '" fill="var(--ink)">unpacked</text>'
    svg += '<line x1="' + (W - 220) + '" x2="' + (W - 196) + '" y1="' + (T + 34) + '" y2="' + (T + 34) + '" stroke="var(--accent)" stroke-width="2.5"/><text x="' + (W - 188) + '" y="' + (T + 38) + '" fill="var(--ink)">proof packing</text>'
    document.getElementById('chart').innerHTML = svg + '</svg>'
  }

  function sources() {
    document.getElementById('srcs').innerHTML = Object.keys(NAMES).map(function (k) {
      var d = DEFAULTS[k]
      var v = typeof d.value === 'boolean' ? (d.value ? 'on' : 'off') : +Number(d.value).toPrecision(6)
      var src = d.url ? '<a href="' + d.url + '">' + d.source + '</a>' : d.source
      return '<tr><td>' + NAMES[k] + '</td><td class="v">' + v + '</td><td><span class="tag ' + (TAGCLS[d.label] || '') + '">' + d.label + '</span></td><td>' + src + (d.date ? ' (' + d.date + ')' : '') + '</td></tr>'
    }).join('')
  }

  document.querySelectorAll('[data-preset]').forEach(function (b) {
    b.addEventListener('click', function () {
      var pr = PRESETS[b.getAttribute('data-preset')]
      state = inputs(pr.values)
      document.getElementById('presetNote').textContent = pr.note || ''
      fill(); render(); save()
    })
  })
  document.getElementById('share').addEventListener('click', function () {
    try { navigator.clipboard.writeText(location.href); this.textContent = 'Link copied' } catch (e) {}
  })

  load(); build(); fill(); sources(); render()
})()
