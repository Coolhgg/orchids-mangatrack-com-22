import { getHybridRecommendations, UserState, getUserState, getHybridWeights } from '../../src/lib/recommendations';
import { supabaseAdmin } from '../../src/lib/supabase/admin';

interface Recommendation {
  match_reasons: string[];
}

async function verifyTransitions() {
  console.log('--- Recommendation Transition System Verification ---');

  // 1. Verify State Logic
  console.log('\n[1] State Transition Logic:');
  const states = [
    { count: 0, expected: UserState.COLD },
    { count: 1, expected: UserState.WARM },
    { count: 5, expected: UserState.WARM },
    { count: 9, expected: UserState.WARM },
    { count: 10, expected: UserState.ACTIVE },
    { count: 50, expected: UserState.ACTIVE },
  ];

  states.forEach(s => {
    const state = getUserState(s.count);
    const pass = state === s.expected;
    console.log(`${pass ? '✅' : '❌'} Count ${s.count} -> ${state} (Expected: ${s.expected})`);
  });

  // 2. Verify Weights per State
  console.log('\n[2] Weight Distribution:');
  [UserState.COLD, UserState.WARM, UserState.ACTIVE].forEach(state => {
    const { gw, pw } = getHybridWeights(state);
    console.log(`- ${state}: Global=${gw.toFixed(1)}, Personal=${pw.toFixed(1)}`);
  });

  // 3. Simulated User Transitions
  console.log('\n[3] Simulated Transitions (API Level):');
  
  // Find a test user with some data if possible
  const { data: users } = await supabaseAdmin.from('users').select('id').limit(1);
  if (!users || users.length === 0) {
    console.log('⚠️ Skipping user tests: No users found in database');
    return;
  }
  const userId = users[0].id;

  console.log(`Using User ID: ${userId}`);

  // Test Cold State (0 interactions)
  console.log('\n- Testing COLD State (0 interactions):');
  const coldRecs: Recommendation[] = await getHybridRecommendations(userId, 0);
  console.log(`  Count: ${coldRecs.length}`);
  console.log(`  Sample Match Reasons: ${Array.from(new Set(coldRecs.map((r: Recommendation) => r.match_reasons[0]))).join(', ')}`);
  
  // Test Warm State (5 interactions)
  console.log('\n- Testing WARM State (5 interactions):');
  const warmRecs: Recommendation[] = await getHybridRecommendations(userId, 5);
  console.log(`  Count: ${warmRecs.length}`);
  const hasPersonal = warmRecs.some((r: Recommendation) => r.match_reasons[0].includes('interests') || r.match_reasons[0].includes('you'));
  console.log(`  ${hasPersonal ? '✅' : 'ℹ️'} Includes personalized reasons`);

  // Test Active State (15 interactions)
  console.log('\n- Testing ACTIVE State (15 interactions):');
  const activeRecs: Recommendation[] = await getHybridRecommendations(userId, 15);
  console.log(`  Count: ${activeRecs.length}`);
  const hasPerfectMatch = activeRecs.some((r: Recommendation) => r.match_reasons[0] === 'Perfect Match');
  console.log(`  ${hasPerfectMatch ? '✅' : 'ℹ️'} Perfect Match logic active (Score > 0.7)`);

  console.log('\n--- Verification Complete ---');
}

verifyTransitions().catch(console.error);
