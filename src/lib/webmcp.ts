/**
 * WebMCP: exposes site tools to AI agents running in the browser via the
 * document.modelContext API (https://webmachinelearning.github.io/webmcp/).
 *
 * Registers only tools that read PUBLIC data from this origin — /api/public/plans
 * and the product overview — no session-scoped dashboard state: an agent in the
 * browser never receives anything the visitor could not load themselves.
 *
 * Runs at module load from src/main.tsx so tools are registered on page load
 * (the WebMCP runtime inspects the context right after the document is ready).
 */

/** MCP tool result shape (subset actually produced below). */
interface WebMcpToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

/** The subset of the API this page uses. */
interface ModelContext {
  registerTool(tool: RegisteredTool, options?: { signal?: AbortSignal }): Promise<unknown>;
}

interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
  execute(args: Record<string, unknown>): WebMcpToolResult | Promise<WebMcpToolResult>;
}

// Older Chrome builds expose the API on navigator.modelContext; the current
// spec surface is document.modelContext (feature-detect document first).
declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}

interface PlanFeed {
  success: boolean;
  plans: Array<{ name: string; slug: string; priceCents: number; interval: string; features: string[] }>;
}

function planText(plan: PlanFeed['plans'][number]): string {
  const price = (plan.priceCents / 100).toFixed(0);
  const bullets = plan.features.length > 0 ? `\n${plan.features.map((feature) => `- ${feature}`).join('\n')}` : '';
  return `## ${plan.name}\n- Prix : ${price} DT par ${plan.interval.replace('_', ' ')}${bullets}`;
}

/** Register the tools; returns an AbortController so callers can unregister.
 * No-ops on browsers without the API (the scanner feature-detects on load). */
export function initWebMcp(): AbortController | null {
  const modelContext = document.modelContext ?? navigator.modelContext;
  if (!modelContext) return null;

  const controller = new AbortController();
  const tools: RegisteredTool[] = [
    {
      name: 'get_dawer_pricing',
      title: 'Get Dawer pricing plans',
      description:
        'Fetches the current Dawer merchant pricing plans (interactive fortune wheel for Tunisian shops): name, price in Tunisian dinar, billing interval and included features. Public marketing data, no login needed.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        const response = await fetch('/api/public/plans');
        const responsePayload = (await response.json()) as Partial<PlanFeed>;
        const plans = Array.isArray(responsePayload.plans) ? responsePayload.plans : [];
        if (plans.length === 0) {
          return { content: [{ type: 'text', text: 'aucun plan tarifaire actif.' }] };
        }
        return {
          content: [{ type: 'text', text: `# Dawer pricing\n\n${plans.map(planText).join('\n\n')}` }],
        };
      },
    },
    {
      name: 'get_dawer_overview',
      title: 'Get Dawer product overview',
      description:
        'Explains what Dawer is (gamified customer acquisition for shops, restaurants and cafés in Tunisia), with official links and contact details. Static public information.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute: () => ({
        content: [
          {
            type: 'text',
            text: [
              '# Dawer — product overview',
              '',
              'Dawer is a gamified customer-acquisition platform for shops, restaurants and',
              "cafés in Tunisia. Merchants place an interactive fortune wheel in their venue:",
              'customers play, share their contact details and win a reward delivered by',
              'WhatsApp or e-mail. Free trial, paid plans, no commitment.',
              '',
              '- Pricing on this page (tool: get_dawer_pricing)',
              '- Privacy: https://dawer.tn/privacy — Blog: https://dawer.tn/blog',
              '- Contact: contact@dawer.com — Tunis, Tunisie (+216 55 000 000)',
              '- Instagram: https://www.instagram.com/dawer.tn — Facebook: https://www.facebook.com/dawer.tn',
            ].join('\n'),
          },
        ],
      }),
    },
  ];

  for (const tool of tools) {
    // Registration is per-page-load: pages host the context, so every navigation
    // decides fresh. The signal unregisters all tools together when this page
    // goes away (kept for future teardown — SPA routes currently keep one page).
    void modelContext.registerTool(tool, { signal: controller.signal }).catch((error: unknown) => {
      // The API is behind a Chrome flag / not every visitor's runtime supports
      // it; a failed registration must never disturb the page.
      console.warn('WebMCP tool registration skipped.', error);
    });
  }

  return controller;
}
