import type { ScopeRule, SubstrateAdapter } from '@into-cps-association/dtaas-sdk';

type Fact = 'room' | 'storey';

/** The room or storey the aec substrate copied onto an element from the property tree. */
function factOf(adapter: SubstrateAdapter, ref: string, fact: Fact): string | undefined {
  const element = adapter.resolve({ kind: 'ifc-guid', ref, signalPath: ref });
  const data = (element?.handle as { userData?: Record<string, unknown> } | undefined)?.userData;
  const value = data?.[fact];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Groups in a `Map` first, so a room named `__proto__` becomes an ordinary key. */
const groupBy = (fact: Fact): ScopeRule['group'] => (elementIds, { adapter }) => {
  const groups = new Map<string, string[]>();
  elementIds.forEach((id) => {
    const key = factOf(adapter, id, fact);
    if (key !== undefined) groups.set(key, [...(groups.get(key) ?? []), id]);
  });
  return Object.fromEntries(groups);
};

/** The two building scopes no generic substrate can know: per room and per storey. */
const scopes: ScopeRule[] = [
  { id: 'bim.room', label: 'Per room', group: groupBy('room') },
  { id: 'bim.storey', label: 'Per storey', group: groupBy('storey') },
];

export default scopes;
