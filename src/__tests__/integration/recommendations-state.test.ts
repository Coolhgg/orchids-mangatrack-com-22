import { getUserState, UserState, getHybridWeights } from '@/lib/recommendations'

describe('Recommendation System - User State Transitions', () => {
  describe('getUserState', () => {
    test('should return COLD for 0 interactions', () => {
      expect(getUserState(0)).toBe(UserState.COLD)
    })

    test('should return WARM for 1-9 interactions', () => {
      expect(getUserState(1)).toBe(UserState.WARM)
      expect(getUserState(5)).toBe(UserState.WARM)
      expect(getUserState(9)).toBe(UserState.WARM)
    })

    test('should return ACTIVE for 10 or more interactions', () => {
      expect(getUserState(10)).toBe(UserState.ACTIVE)
      expect(getUserState(50)).toBe(UserState.ACTIVE)
    })
  })

  describe('getHybridWeights', () => {
    test('should return correct weights for COLD state', () => {
      expect(getHybridWeights(UserState.COLD)).toEqual({ gw: 1.0, pw: 0.0 })
    })

    test('should return correct weights for WARM state', () => {
      expect(getHybridWeights(UserState.WARM)).toEqual({ gw: 0.6, pw: 0.4 })
    })

    test('should return correct weights for ACTIVE state', () => {
      expect(getHybridWeights(UserState.ACTIVE)).toEqual({ gw: 0.3, pw: 0.7 })
    })
  })
})
