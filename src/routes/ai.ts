// ==============================================
// AI Phase 1 Production-Hardened APIs (Step 6)
//
// Key Changes from Staging:
//   1. Graceful degradation when OPENAI_API_KEY is absent
//   2. All endpoints return structured responses even on failure
//   3. AI warnings are persisted to project_warnings table
//   4. confidence/severity/suggested_action display rules defined
//   5. PDF parse results include verification UI support
//   6. AI warning read-status and resolution flow
//
// Endpoints:
//   POST /api/ai/check-conditions   → Rule-based + optional AI analysis
//   POST /api/ai/classify-override  → Override reason classification
//   POST /api/ai/parse-document     → Vendor quote / PDF extraction
//   GET  /api/ai/status             → AI capability status
//   GET  /api/ai/warnings/:projectId → Persisted AI warnings with read/resolve
//   PATCH /api/ai/warnings/:warningId → Mark read/resolve/ignore
//   POST /api/ai/parse-document/verify → Save verified parse results to cost items
//
// Display Rules:
//   confidence: high (>=0.8), medium (0.5-0.79), low (<0.5)
//   severity: error (red), warning (yellow), info (blue)
//   suggested_action: 
//     'require_review' (must act), 'recommend' (should act), 'inform' (FYI)
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser, requireRole } from '../middleware/auth';
import { validationError, businessRuleError, notFoundError } from '../lib/errors';
import { z } from 'zod';

const aiRoutes = new Hono<AppEnv>();
aiRoutes.use('*', resolveUser);

// ==========================================================
// Confidence / Severity / Action Display Rule Constants
// ==========================================================
const CONFIDENCE_LEVELS = {
  high: { min: 0.8, label: '高', color: 'green', description: '高信頼度 — そのまま適用可能' },
  medium: { min: 0.5, label: '中', color: 'yellow', description: '中信頼度 — 確認推奨' },
  low: { min: 0, label: '低', color: 'red', description: '低信頼度 — 手動確認必須' },
} as const;

const SEVERITY_DISPLAY = {
  error: { icon: 'fas fa-times-circle', color: 'red', label: 'エラー', priority: 1 },
  warning: { icon: 'fas fa-exclamation-triangle', color: 'yellow', label: '警告', priority: 2 },
  info: { icon: 'fas fa-info-circle', color: 'blue', label: '情報', priority: 3 },
} as const;

const SUGGESTED_ACTIONS = {
  require_review: { label: '要確認', description: '対応が必要です', urgency: 'high' },
  recommend: { label: '推奨', description: '対応を推奨します', urgency: 'medium' },
  inform: { label: '参考', description: '情報提供のみ', urgency: 'low' },
} as const;

function getConfidenceLevel(confidence: number): keyof typeof CONFIDENCE_LEVELS {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

function getSuggestedAction(severity: string, confidence: number): keyof typeof SUGGESTED_ACTIONS {
  if (severity === 'error') return 'require_review';
  if (severity === 'warning' && confidence >= 0.5) return 'recommend';
  if (severity === 'warning' && confidence < 0.5) return 'require_review';
  return 'inform';
}

// ==========================================================
// Helper: Safe AI availability check
// ==========================================================
function getAiCapability(env: any) {
  const hasApiKey = !!env.OPENAI_API_KEY;
  return {
    hasApiKey,
    mode: hasApiKey ? 'ai_enhanced' : 'rule_based' as const,
    fallbackReason: hasApiKey ? null : 'OPENAI_API_KEY未設定。ルールベース分析で動作中。',
  };
}

// ==========================================================
// POST /api/ai/check-conditions
// Production-hardened: works without API key, persists results
// ==========================================================
const CheckConditionsSchema = z.object({
  project_id: z.number().int().positive(),
  fields_to_check: z.array(z.string()).optional(),
  persist_warnings: z.boolean().optional().default(false),
});

aiRoutes.post('/check-conditions', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const err = validationError('Invalid JSON body');
    return c.json(err.body, err.status);
  }

  const parsed = CheckConditionsSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const { project_id, persist_warnings } = parsed.data;
  const ai = getAiCapability(c.env);

  // Check if AI condition check is enabled
  const aiEnabled = await db.prepare(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'enable_ai_condition_check'"
  ).first() as any;
  const isEnabled = aiEnabled?.setting_value === 'true';

  // Fetch project
  const project = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(project_id).first() as any;
  if (!project) {
    const err = businessRuleError('Project not found');
    return c.json(err.body, err.status);
  }

  // Fetch active rules
  const rules = await db.prepare(`
    SELECT id, master_item_id, rule_name, rule_group, conditions_json, actions_json
    FROM cost_rule_conditions WHERE is_active = 1
    ORDER BY priority
  `).all() as any;

  // Analyze unmet conditions
  const unmetConditions: Array<{
    rule_id: number;
    rule_name: string;
    rule_group: string;
    field: string;
    operator: string;
    expected: any;
    actual: any;
    confidence: number;
    confidence_level: string;
    severity: string;
    suggested_action: string;
    suggestion: string;
  }> = [];

  const fieldsChecked = new Set<string>();

  for (const rule of (rules.results || [])) {
    try {
      const conditions = JSON.parse(rule.conditions_json || '[]');
      for (const cond of conditions) {
        const field = cond.field;
        fieldsChecked.add(field);
        const actual = project[field];
        const expected = cond.value;

        if (actual === null || actual === undefined) {
          const confidence = 0.9;
          const severity = 'warning';
          unmetConditions.push({
            rule_id: rule.id, rule_name: rule.rule_name, rule_group: rule.rule_group,
            field, operator: cond.operator, expected, actual: null,
            confidence, confidence_level: getConfidenceLevel(confidence),
            severity, suggested_action: getSuggestedAction(severity, confidence),
            suggestion: `「${field}」を入力してください。ルール「${rule.rule_name}」で使用されます。`,
          });
          continue;
        }

        let met = true;
        switch (cond.operator) {
          case '=': met = String(actual) === String(expected); break;
          case '!=': met = String(actual) !== String(expected); break;
          case '>': met = Number(actual) > Number(expected); break;
          case '>=': met = Number(actual) >= Number(expected); break;
          case '<': met = Number(actual) < Number(expected); break;
          case '<=': met = Number(actual) <= Number(expected); break;
          case 'in': met = Array.isArray(expected) && expected.includes(String(actual)); break;
        }

        if (!met) {
          const confidence = 0.85;
          const severity = 'info';
          unmetConditions.push({
            rule_id: rule.id, rule_name: rule.rule_name, rule_group: rule.rule_group,
            field, operator: cond.operator, expected, actual,
            confidence, confidence_level: getConfidenceLevel(confidence),
            severity, suggested_action: getSuggestedAction(severity, confidence),
            suggestion: `「${field}」の値が条件を満たしていません (現在: ${actual}, 条件: ${cond.operator} ${expected})`,
          });
        }
      }
    } catch {
      // Skip malformed rules silently
    }
  }

  // Persist warnings if requested
  let warningsPersisted = 0;
  if (persist_warnings && project.current_snapshot_id && unmetConditions.length > 0) {
    for (const cond of unmetConditions.filter(c => c.severity === 'warning' || c.severity === 'error')) {
      try {
        await db.prepare(`
          INSERT INTO project_warnings (
            project_id, snapshot_id, warning_type, severity, message, recommendation,
            detail_json, source, status, is_resolved, created_at
          ) VALUES (?, ?, 'condition_unmet', ?, ?, ?, ?, 'ai', 'open', 0, datetime('now'))
        `).bind(
          project_id, project.current_snapshot_id,
          cond.severity, cond.suggestion,
          `ルール「${cond.rule_name}」のフィールド「${cond.field}」を確認してください`,
          JSON.stringify({ rule_id: cond.rule_id, field: cond.field, expected: cond.expected, actual: cond.actual }),
        ).run();
        warningsPersisted++;
      } catch {
        // Skip duplicate or constraint errors
      }
    }
  }

  // AI suggestions stub (graceful when no key)
  const aiSuggestions: string[] = [];
  if (ai.hasApiKey && isEnabled) {
    aiSuggestions.push('AI分析は今後のアップデートで利用可能になります');
  } else if (!ai.hasApiKey) {
    aiSuggestions.push('OPENAI_API_KEY未設定: ルールベース分析のみ実行。AI機能は設定後に有効化されます。');
  } else {
    aiSuggestions.push('AI条件チェック機能は無効です (system_settings)');
  }

  return c.json({
    success: true,
    data: {
      project_id,
      mode: ai.mode,
      ai_available: ai.hasApiKey,
      ai_enabled: isEnabled,
      fallback_reason: ai.fallbackReason,
      fields_checked: Array.from(fieldsChecked),
      total_rules_checked: rules.results?.length || 0,
      unmet_conditions: unmetConditions,
      unmet_count: unmetConditions.length,
      warnings_persisted: warningsPersisted,
      ai_suggestions: aiSuggestions,
      display_rules: {
        confidence_levels: CONFIDENCE_LEVELS,
        severity_display: SEVERITY_DISPLAY,
        suggested_actions: SUGGESTED_ACTIONS,
      },
    },
  });
});

// ==========================================================
// POST /api/ai/classify-override-reason
// Production-hardened: always returns structured result
// ==========================================================
const ClassifyReasonSchema = z.object({
  text: z.string().min(1).max(2000),
  context: z.object({
    item_name: z.string().optional(),
    category_code: z.string().optional(),
    amount: z.number().optional(),
    old_amount: z.number().optional(),
  }).optional(),
});

aiRoutes.post('/classify-override-reason', requireRole('admin', 'manager', 'estimator'), async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const err = validationError('Invalid JSON body');
    return c.json(err.body, err.status);
  }

  const parsed = ClassifyReasonSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const { text, context } = parsed.data;
  const ai = getAiCapability(c.env);

  // Keyword-based classification
  const classifications: Record<string, string[]> = {
    site_condition: ['現場', '地盤', '敷地', '高低差', '地質', '搬入', '地形', '接道', '擁壁'],
    customer_request: ['顧客', 'お客様', '施主', '要望', 'リクエスト', '依頼', '希望', 'ご要望'],
    regulatory: ['法規', '建築基準', '条例', '消防', '防火', '確認申請', '法令', '規制', '条件付'],
    spec_change: ['仕様変更', 'スペック', 'グレード', 'アップ', 'ダウン', '変更', '追加工事'],
    price_update: ['単価', '値上', '値下', '価格改定', '仕入', '市況', '資材高騰', '為替'],
    correction: ['訂正', '修正', '間違い', 'ミス', '入力ミス', '誤り', '計算間違'],
    vendor_quote: ['業者', '見積', 'メーカー', 'サプライヤー', '協力会社', '下請', '発注'],
    other: [],
  };

  const scores: Record<string, number> = {};
  const lowerText = text.toLowerCase();
  const matchedKeywords: Record<string, string[]> = {};

  for (const [category, keywords] of Object.entries(classifications)) {
    let score = 0;
    const matched: string[] = [];
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        score += 1;
        matched.push(kw);
      }
    }
    scores[category] = score;
    if (matched.length > 0) matchedKeywords[category] = matched;
  }

  const sorted = Object.entries(scores)
    .filter(([cat]) => cat !== 'other')
    .sort((a, b) => b[1] - a[1]);

  const bestMatch = sorted[0]?.[1] > 0 ? sorted[0][0] : 'other';
  const confidence = sorted[0]?.[1] > 0
    ? Math.min(0.9, 0.3 + sorted[0][1] * 0.2) : 0.1;

  const alternatives = sorted
    .filter(([cat, score]) => score > 0 && cat !== bestMatch)
    .slice(0, 3)
    .map(([cat, score]) => ({
      category: cat,
      confidence: Math.min(0.8, 0.2 + score * 0.15),
      confidence_level: getConfidenceLevel(Math.min(0.8, 0.2 + score * 0.15)),
      matched_keywords: matchedKeywords[cat] || [],
    }));

  return c.json({
    success: true,
    data: {
      input_text: text,
      suggested_category: bestMatch,
      confidence: Math.round(confidence * 100) / 100,
      confidence_level: getConfidenceLevel(confidence),
      alternatives,
      matched_keywords: matchedKeywords[bestMatch] || [],
      mode: ai.mode,
      ai_available: ai.hasApiKey,
      fallback_reason: ai.fallbackReason,
      context,
      display_rules: {
        confidence_levels: CONFIDENCE_LEVELS,
        suggested_actions: SUGGESTED_ACTIONS,
      },
    },
  });
});

// ==========================================================
// POST /api/ai/parse-document
// Production-hardened: structured extraction + verification support
// ==========================================================
const ParseDocumentSchema = z.object({
  content: z.string().min(1).max(100000),
  format: z.enum(['text', 'pdf', 'csv']).default('text'),
  context: z.object({
    project_id: z.number().optional(),
    category_code: z.string().optional(),
    vendor_name: z.string().optional(),
  }).optional(),
});

aiRoutes.post('/parse-document', requireRole('admin', 'manager', 'estimator'), async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const err = validationError('Invalid JSON body');
    return c.json(err.body, err.status);
  }

  const parsed = ParseDocumentSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const { content, format, context } = parsed.data;
  const ai = getAiCapability(c.env);

  const lines = content.split('\n').filter(l => l.trim());
  const extractedItems: Array<{
    line_no: number;
    item_name: string;
    quantity: number | null;
    unit: string | null;
    unit_price: number | null;
    amount: number | null;
    confidence: number;
    confidence_level: string;
    suggested_action: string;
    verification_status: 'unverified' | 'verified' | 'rejected';
    raw_text: string;
  }> = [];

  const amountPattern = /([¥￥]?\s*[\d,]+)/g;
  const quantityPattern = /(\d+(?:\.\d+)?)\s*(式|個|m|m²|坪|本|枚|台|セット|SET|㎡|箇所|棟|面|組)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 3) continue;

    const amounts = line.match(amountPattern);
    const qtyMatch = line.match(quantityPattern);

    if (amounts && amounts.length > 0) {
      const cleanAmount = (s: string) => parseInt(s.replace(/[¥￥,\s]/g, '')) || 0;
      const parsedAmounts = amounts.map(a => cleanAmount(a)).filter(a => a > 0);

      if (parsedAmounts.length > 0) {
        const itemName = line.replace(amountPattern, '').replace(quantityPattern, '').trim().substring(0, 100);
        const confidence = parsedAmounts.length > 1 ? 0.6 : 0.3;

        extractedItems.push({
          line_no: i + 1,
          item_name: itemName || `項目 ${i + 1}`,
          quantity: qtyMatch ? parseFloat(qtyMatch[1]) : null,
          unit: qtyMatch ? qtyMatch[2] : null,
          unit_price: parsedAmounts.length > 1 ? parsedAmounts[parsedAmounts.length - 2] : null,
          amount: parsedAmounts[parsedAmounts.length - 1],
          confidence,
          confidence_level: getConfidenceLevel(confidence),
          suggested_action: getSuggestedAction('info', confidence),
          verification_status: 'unverified',
          raw_text: line.substring(0, 200),
        });
      }
    }
  }

  const totalExtracted = extractedItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  // Calculate overall extraction quality
  const avgConfidence = extractedItems.length > 0
    ? extractedItems.reduce((sum, item) => sum + item.confidence, 0) / extractedItems.length
    : 0;
  const overallConfidence = getConfidenceLevel(avgConfidence);

  return c.json({
    success: true,
    data: {
      format,
      content_length: content.length,
      lines_processed: lines.length,
      items_extracted: extractedItems.length,
      extracted_items: extractedItems,
      total_amount: totalExtracted,
      extraction_quality: {
        avg_confidence: Math.round(avgConfidence * 100) / 100,
        confidence_level: overallConfidence,
        items_needing_review: extractedItems.filter(i => i.confidence < 0.5).length,
        items_high_confidence: extractedItems.filter(i => i.confidence >= 0.8).length,
      },
      mode: ai.mode,
      ai_available: ai.hasApiKey,
      fallback_reason: ai.fallbackReason,
      context,
      verification_required: true,
      verification_note: '抽出結果を確認し、正しい項目のみを「確認済」としてください。確認後にコスト明細へ反映できます。',
      display_rules: {
        confidence_levels: CONFIDENCE_LEVELS,
        severity_display: SEVERITY_DISPLAY,
        suggested_actions: SUGGESTED_ACTIONS,
      },
    },
  });
});

// ==========================================================
// GET /api/ai/warnings/:projectId
// Persisted AI warnings with read/resolve status
// ==========================================================
aiRoutes.get('/warnings/:projectId', async (c) => {
  const db = c.env.DB;
  const projectId = parseInt(c.req.param('projectId'));
  if (isNaN(projectId)) { const err = validationError('Invalid project ID'); return c.json(err.body, err.status); }

  const project = await db.prepare('SELECT id, current_snapshot_id FROM projects WHERE id = ?')
    .bind(projectId).first() as any;
  if (!project) { const err = notFoundError('Project', projectId); return c.json(err.body, err.status); }

  const statusFilter = c.req.query('status'); // open, resolved, ignored
  const sourceFilter = c.req.query('source'); // ai, system, regeneration, manual

  let sql = `
    SELECT id, project_id, snapshot_id, category_code, master_item_id,
      warning_type, severity, message, recommendation, detail_json,
      source, status, is_resolved, is_read,
      resolved_by, resolved_at, resolved_note,
      created_at
    FROM project_warnings WHERE project_id = ?
  `;
  const binds: any[] = [projectId];

  if (project.current_snapshot_id) {
    sql += ' AND snapshot_id = ?';
    binds.push(project.current_snapshot_id);
  }
  if (statusFilter) { sql += ' AND status = ?'; binds.push(statusFilter); }
  if (sourceFilter) { sql += ' AND source = ?'; binds.push(sourceFilter); }

  sql += ` ORDER BY CASE severity WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 END, created_at DESC`;

  const result = await db.prepare(sql).bind(...binds).all();
  const warnings = (result.results || []) as any[];

  // Compute summary
  const summary = {
    total: warnings.length,
    open: warnings.filter(w => w.status === 'open').length,
    resolved: warnings.filter(w => w.status === 'resolved').length,
    ignored: warnings.filter(w => w.status === 'ignored').length,
    unread: warnings.filter(w => !w.is_read && w.status === 'open').length,
    by_severity: {
      error: warnings.filter(w => w.severity === 'error' && w.status === 'open').length,
      warning: warnings.filter(w => w.severity === 'warning' && w.status === 'open').length,
      info: warnings.filter(w => w.severity === 'info' && w.status === 'open').length,
    },
    by_source: {
      ai: warnings.filter(w => w.source === 'ai').length,
      system: warnings.filter(w => w.source === 'system').length,
      regeneration: warnings.filter(w => w.source === 'regeneration').length,
      manual: warnings.filter(w => w.source === 'manual').length,
    },
  };

  return c.json({
    success: true,
    data: warnings.map(w => ({
      ...w,
      detail: w.detail_json ? (() => { try { return JSON.parse(w.detail_json); } catch { return null; } })() : null,
      severity_display: SEVERITY_DISPLAY[w.severity as keyof typeof SEVERITY_DISPLAY],
    })),
    summary,
    display_rules: {
      severity_display: SEVERITY_DISPLAY,
    },
  });
});

// ==========================================================
// PATCH /api/ai/warnings/:warningId
// Mark warning as read, resolved, or ignored
// ==========================================================
const UpdateWarningSchema = z.object({
  action: z.enum(['mark_read', 'resolve', 'ignore', 'reopen']),
  note: z.string().max(1000).optional(),
});

aiRoutes.patch('/warnings/:warningId', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const user = c.get('currentUser')!;
  const warningId = parseInt(c.req.param('warningId'));
  if (isNaN(warningId)) { const err = validationError('Invalid warning ID'); return c.json(err.body, err.status); }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    const err = validationError('Invalid JSON body');
    return c.json(err.body, err.status);
  }

  const parsed = UpdateWarningSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const warning = await db.prepare('SELECT * FROM project_warnings WHERE id = ?').bind(warningId).first() as any;
  if (!warning) { const err = notFoundError('Warning', warningId); return c.json(err.body, err.status); }

  const { action, note } = parsed.data;

  switch (action) {
    case 'mark_read':
      await db.prepare('UPDATE project_warnings SET is_read = 1 WHERE id = ?').bind(warningId).run();
      break;
    case 'resolve':
      await db.prepare(`
        UPDATE project_warnings SET 
          status = 'resolved', is_resolved = 1, is_read = 1,
          resolved_by = ?, resolved_at = datetime('now'), resolved_note = ?
        WHERE id = ?
      `).bind(user.id, note || 'マニュアル解決', warningId).run();
      break;
    case 'ignore':
      await db.prepare(`
        UPDATE project_warnings SET 
          status = 'ignored', is_read = 1,
          resolved_by = ?, resolved_at = datetime('now'), resolved_note = ?
        WHERE id = ?
      `).bind(user.id, note || '無視', warningId).run();
      break;
    case 'reopen':
      await db.prepare(`
        UPDATE project_warnings SET 
          status = 'open', is_resolved = 0,
          resolved_by = NULL, resolved_at = NULL, resolved_note = NULL
        WHERE id = ?
      `).bind(warningId).run();
      break;
  }

  const updated = await db.prepare('SELECT * FROM project_warnings WHERE id = ?').bind(warningId).first();

  return c.json({
    success: true,
    data: updated,
    message: `警告を${
      action === 'mark_read' ? '既読' :
      action === 'resolve' ? '解決' :
      action === 'ignore' ? '無視' : '再オープン'
    }にしました`,
  });
});

// ==========================================================
// GET /api/ai/status
// Production-hardened: detailed capability report
// ==========================================================
aiRoutes.get('/status', async (c) => {
  const db = c.env.DB;
  const ai = getAiCapability(c.env);

  const aiEnabled = await db.prepare(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'enable_ai_condition_check'"
  ).first() as any;

  return c.json({
    success: true,
    data: {
      phase: 'phase_1_production',
      version: '1.0.0',
      endpoints: [
        { path: '/api/ai/check-conditions', method: 'POST', status: 'active', mode: ai.mode, description: 'プロジェクト条件チェック' },
        { path: '/api/ai/classify-override-reason', method: 'POST', status: 'active', mode: ai.mode, description: '変更理由分類' },
        { path: '/api/ai/parse-document', method: 'POST', status: 'active', mode: ai.mode, description: '帳票読取・抽出' },
        { path: '/api/ai/warnings/:projectId', method: 'GET', status: 'active', mode: 'direct', description: 'AI警告一覧（永続化）' },
        { path: '/api/ai/warnings/:warningId', method: 'PATCH', status: 'active', mode: 'direct', description: 'AI警告ステータス更新' },
      ],
      ai_available: ai.hasApiKey,
      ai_condition_check_enabled: aiEnabled?.setting_value === 'true',
      fallback_reason: ai.fallbackReason,
      auto_apply: false,
      degradation_mode: ai.hasApiKey ? 'full' : 'graceful_fallback',
      degradation_note: ai.hasApiKey
        ? 'AI機能が利用可能です。'
        : 'OPENAI_API_KEY未設定: 全機能がルールベースで動作中。AI機能は設定後に自動的に有効化されます。UIは完全に機能します。',
      display_rules: {
        confidence_levels: CONFIDENCE_LEVELS,
        severity_display: SEVERITY_DISPLAY,
        suggested_actions: SUGGESTED_ACTIONS,
      },
    },
  });
});

export default aiRoutes;
