'use client';

const plans = [
  {
    name: 'Starter',
    price: '€29',
    period: '/mois',
    featured: false,
    description: 'Pour tester les campagnes locales.',
    features: ['1 campagne active', '100 clients', '3 récompenses', 'Support email'],
    status: 'current',
  },
  {
    name: 'Growth',
    price: '€79',
    period: '/mois',
    featured: true,
    description: 'Pour les marques qui veulent accélérer.',
    features: ['10 campagnes', '10 000 clients', 'Réseaux sociaux', 'Analytics avancées'],
    status: 'upgrade',
  },
  {
    name: 'Scale',
    price: '€149',
    period: '/mois',
    featured: false,
    description: 'Pour les opérations multi-sites.',
    features: ['Campagnes illimitées', 'Support prioritaire', 'API / intégrations', 'SSO'],
    status: 'downgrade',
  },
];

export default function PricingPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Tarification</p>
        <h2 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">Choisissez un plan adapté à votre croissance</h2>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.name} className={`rounded-3xl border p-6 shadow-soft ${plan.featured ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{plan.name}</h3>
              {plan.featured && <span className="rounded-full bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white">Populaire</span>}
            </div>
            <div className="mt-5 flex items-end gap-2">
              <span className="text-4xl font-semibold text-slate-900 dark:text-slate-100">{plan.price}</span>
              <span className="pb-2 text-sm text-slate-500 dark:text-slate-400">{plan.period}</span>
            </div>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{plan.description}</p>
            <ul className="mt-5 space-y-3 text-sm text-slate-700 dark:text-slate-200">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  {feature}
                </li>
              ))}
            </ul>
            <button type="button" className={`mt-6 w-full rounded-xl px-4 py-2.5 text-sm font-medium ${plan.featured ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
              {plan.status === 'current' ? 'Plan actuel' : plan.status === 'upgrade' ? 'Mise à niveau' : 'Downgrade'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
