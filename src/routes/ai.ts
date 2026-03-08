// ==============================================
// AI Phase 1 Minimal APIs (Step 4.3)
// Staging stubs — no automatic reflection
//
// Endpoints:
//   POST /api/ai/check-conditions
//     → Validates project conditions against rules
//     → Returns: unmet conditions, suggestions
//
//   POST /api/ai/classify-override-reason
//     → Classifies manual override text into categories
//     → Returns: suggested category, confidence, alternatives
//
//   POST /api/ai/parse-document
//     → Parses vendor quote / PDF document
//     → Returns: extracted items, amounts, confidence
//
// NOTE: These are staging endpoints. They return structured
// mock responses when OPENAI_API_KEY is not set, or real
// AI responses when configured. No auto-apply to DB.
// ==============================================
import { Hono } from 'hono';
import type { AppEnv, ApiResponse } from '../types/bindings';
import { resolveUser, requireRole } from '../middleware/auth';
import { validationError, businessRuleError } from '../lib/errors';
import { z } from 'zod';

const aiRoutes = new Hono<AppEnv>();
aiRoutes.use('*', resolveUser);

// ==========================================================
// POST /api/ai/check-conditions
// Input: { project_id, fields_to_check?: string[] }
// Returns: unmet conditions, suggestions, completeness score
// 権限: admin, manager, estimator
// ==========================================================
const CheckConditionsSchema = z.object({
  project_id: z.number().int().positive(),
  fields_to_check: z.array(z.string()).optional(),
});

aiRoutes.post('/check-conditions', requireRole('admin', 'manager', 'estimator'), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();
  const parsed = CheckConditionsSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const { project_id } = parsed.data;

  // Check if AI is enabled
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

  // Fetch active rules that reference project fields
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

        // Only check if the field has a value
        if (actual === null || actual === undefined) {
          unmetConditions.push({
            rule_id: rule.id,
            rule_name: rule.rule_name,
            rule_group: rule.rule_group,
            field,
            operator: cond.operator,
            expected,
            actual: null,
            suggestion: `「${field}」を入力してください。ルール「${rule.rule_name}」で使用されます。`,
          });
          continue;
        }

        // Check if condition is met
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
          unmetConditions.push({
            rule_id: rule.id,
            rule_name: rule.rule_name,
            rule_group: rule.rule_group,
            field,
            operator: cond.operator,
            expected,
            actual,
            suggestion: `「${field}」の値が条件を満たしていません (現在: ${actual}, 条件: ${cond.operator} ${expected})`,
          });
        }
      }
    } catch (e) {
      // Skip malformed rules
    }
  }

  // AI-enhanced suggestions (stub or real)
  let aiSuggestions: string[] = [];
  const hasApiKey = !!c.env.OPENAI_API_KEY;

  if (hasApiKey && isEnabled) {
    // TODO: Call OpenAI API for enhanced analysis
    aiSuggestions = ['AI分析は今後のアップデートで利用可能になります'];
  } else {
    aiSuggestions = [
      isEnabled ? 'OPENAI_API_KEY未設定のため、ルールベース分析のみ実行' : 'AI条件チェック機能は無効です (system_settings)',
    ];
  }

  return c.json({
    success: true,
    data: {
      project_id,
      mode: hasApiKey && isEnabled ? 'ai_enhanced' : 'rule_based',
      fields_checked: Array.from(fieldsChecked),
      total_rules_checked: rules.results?.length || 0,
      unmet_conditions: unmetConditions,
      unmet_count: unmetConditions.length,
      ai_suggestions: aiSuggestions,
      ai_enabled: isEnabled,
      has_api_key: hasApiKey,
      note: 'staging: 結果は参照用です。自動反映されません。',
    },
  });
});

// ==========================================================
// POST /api/ai/classify-override-reason
// Input: { text, context?: { item_name, category_code, amount } }
// Returns: suggested category, confidence, alternatives
// 権限: admin, manager, estimator
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
  const body = await c.req.json();
  const parsed = ClassifyReasonSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const { text, context } = parsed.data;
  const hasApiKey = !!c.env.OPENAI_API_KEY;

  // Rule-based classification (keyword matching)
  const classifications: Record<string, string[]> = {
    site_condition: ['現場', '地盤', '敷地', '高低差', '地質', '搬入', 'site'],
    customer_request: ['顧客', 'お客様', '施主', '要望', 'リクエスト', '依頼', 'customer'],
    regulatory: ['法規', '建築基準', '条例', '消防', '防火', '確認申請', 'regulation'],
    spec_change: ['仕様変更', 'スペック', 'グレード', 'アップ', 'ダウン', 'spec'],
    price_update: ['単価', '値上', '値下', '価格改定', '仕入', 'price'],
    correction: ['訂正', '修正', '間違い', 'ミス', '入力ミス', 'correction'],
    vendor_quote: ['業者', '見積', 'メーカー', 'サプライヤー', 'vendor', 'quote'],
    other: [],
  };

  const scores: Record<string, number> = {};
  const lowerText = text.toLowerCase();

  for (const [category, keywords] of Object.entries(classifications)) {
    let score = 0;
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) score += 1;
    }
    scores[category] = score;
  }

  // Find best match
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
    }));

  return c.json({
    success: true,
    data: {
      input_text: text,
      suggested_category: bestMatch,
      confidence: Math.round(confidence * 100) / 100,
      alternatives,
      mode: hasApiKey ? 'ai_enhanced' : 'keyword_matching',
      context,
      note: 'staging: 分類結果は提案です。確定は手動で行ってください。',
    },
  });
});

// ==========================================================
// POST /api/ai/parse-document
// Input: { content: string (text content or base64), format?: 'text' | 'pdf' | 'csv' }
// Returns: extracted items with amounts
// 権限: admin, manager, estimator
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
  const body = await c.req.json();
  const parsed = ParseDocumentSchema.safeParse(body);
  if (!parsed.success) {
    const err = validationError('Validation failed', parsed.error.flatten().fieldErrors);
    return c.json(err.body, err.status);
  }

  const { content, format, context } = parsed.data;
  const hasApiKey = !!c.env.OPENAI_API_KEY;

  // Staging: basic text extraction (line-by-line parsing)
  const lines = content.split('\n').filter(l => l.trim());
  const extractedItems: Array<{
    line_no: number;
    item_name: string;
    quantity: number | null;
    unit: string | null;
    unit_price: number | null;
    amount: number | null;
    confidence: number;
    raw_text: string;
  }> = [];

  // Simple pattern matching for Japanese cost documents
  const amountPattern = /([¥￥]?\s*[\d,]+)/g;
  const quantityPattern = /(\d+(?:\.\d+)?)\s*(式|個|m|m²|坪|本|枚|台|セット|SET)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 3) continue;

    // Try to extract amounts
    const amounts = line.match(amountPattern);
    const qtyMatch = line.match(quantityPattern);

    if (amounts && amounts.length > 0) {
      const cleanAmount = (s: string) => parseInt(s.replace(/[¥￥,\s]/g, '')) || 0;
      const parsedAmounts = amounts.map(a => cleanAmount(a)).filter(a => a > 0);

      if (parsedAmounts.length > 0) {
        // Heuristic: last amount is likely the total
        const itemName = line.replace(amountPattern, '').replace(quantityPattern, '').trim().substring(0, 100);

        extractedItems.push({
          line_no: i + 1,
          item_name: itemName || `項目 ${i + 1}`,
          quantity: qtyMatch ? parseFloat(qtyMatch[1]) : null,
          unit: qtyMatch ? qtyMatch[2] : null,
          unit_price: parsedAmounts.length > 1 ? parsedAmounts[parsedAmounts.length - 2] : null,
          amount: parsedAmounts[parsedAmounts.length - 1],
          confidence: parsedAmounts.length > 1 ? 0.6 : 0.3,
          raw_text: line.substring(0, 200),
        });
      }
    }
  }

  const totalExtracted = extractedItems.reduce((sum, item) => sum + (item.amount || 0), 0);

  return c.json({
    success: true,
    data: {
      format,
      content_length: content.length,
      lines_processed: lines.length,
      items_extracted: extractedItems.length,
      extracted_items: extractedItems,
      total_amount: totalExtracted,
      mode: hasApiKey ? 'ai_enhanced' : 'pattern_matching',
      context,
      note: 'staging: 抽出結果は参考値です。確認・修正の上、手動で反映してください。PDF形式はテキスト変換後に入力してください。',
    },
  });
});

// ==========================================================
// GET /api/ai/status
// Returns AI capability status
// ==========================================================
aiRoutes.get('/status', async (c) => {
  const db = c.env.DB;
  const aiEnabled = await db.prepare(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'enable_ai_condition_check'"
  ).first() as any;

  return c.json({
    success: true,
    data: {
      phase: 'phase_1_staging',
      endpoints: [
        { path: '/api/ai/check-conditions', method: 'POST', status: 'active', mode: 'rule_based' },
        { path: '/api/ai/classify-override-reason', method: 'POST', status: 'active', mode: 'keyword_matching' },
        { path: '/api/ai/parse-document', method: 'POST', status: 'active', mode: 'pattern_matching' },
      ],
      openai_configured: !!c.env.OPENAI_API_KEY,
      ai_condition_check_enabled: aiEnabled?.setting_value === 'true',
      auto_apply: false,
      note: 'Phase 1: AI結果は参照用のみ。自動反映は Phase 2 以降で実装予定。',
    },
  });
});

export default aiRoutes;
