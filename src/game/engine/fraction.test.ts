import { describe, it, expect } from 'vitest'
import {
  makeFraction, addInt, divideByInt, multiplyByInt, isZero, fractionDivMod,
  ZERO, HALF, ONE,
} from './fraction'

describe('makeFraction', () => {
  it('reduces to lowest terms', () => {
    expect(makeFraction(2, 4)).toEqual({ numerator: 1, denominator: 2 })
    expect(makeFraction(6, 3)).toEqual({ numerator: 2, denominator: 1 })
  })

  it('normalizes a negative denominator onto the numerator', () => {
    expect(makeFraction(1, -2)).toEqual({ numerator: -1, denominator: 2 })
  })

  it('reduces zero to 0/1 regardless of the input denominator', () => {
    expect(makeFraction(0, 5)).toEqual({ numerator: 0, denominator: 1 })
  })
})

describe('constants', () => {
  it('ZERO, HALF, and ONE have the expected values', () => {
    expect(ZERO).toEqual({ numerator: 0, denominator: 1 })
    expect(HALF).toEqual({ numerator: 1, denominator: 2 })
    expect(ONE).toEqual({ numerator: 1, denominator: 1 })
  })
})

describe('addInt', () => {
  it('adds an integer to a fraction', () => {
    expect(addInt(HALF, 1)).toEqual({ numerator: 3, denominator: 2 })
    expect(addInt(makeFraction(1, 3), 0)).toEqual({ numerator: 1, denominator: 3 })
  })
})

describe('divideByInt', () => {
  it('divides a fraction by an integer', () => {
    expect(divideByInt(makeFraction(3, 2), 3)).toEqual({ numerator: 1, denominator: 2 })
  })
})

describe('multiplyByInt', () => {
  it('multiplies a fraction by an integer', () => {
    expect(multiplyByInt(makeFraction(1, 6), 3)).toEqual({ numerator: 1, denominator: 2 })
    expect(multiplyByInt(ZERO, 4)).toEqual({ numerator: 0, denominator: 1 })
  })
})

describe('isZero', () => {
  it('is true only for a reduced zero fraction', () => {
    expect(isZero(ZERO)).toBe(true)
    expect(isZero(makeFraction(0, 7))).toBe(true)
    expect(isZero(HALF)).toBe(false)
  })
})

describe('fractionDivMod', () => {
  it('splits 1/2 by a unit of 1/3 into offset 1 and remainder 1/6', () => {
    expect(fractionDivMod(HALF, makeFraction(1, 3))).toEqual({
      offset: 1,
      remainder: { numerator: 1, denominator: 6 },
    })
  })

  it('splits 3/8 by a unit of 1/4 into offset 1 and remainder 1/8', () => {
    expect(fractionDivMod(makeFraction(3, 8), makeFraction(1, 4))).toEqual({
      offset: 1,
      remainder: { numerator: 1, denominator: 8 },
    })
  })

  it('splits 2/3 by a unit of 1/3 into offset 2 and a zero remainder', () => {
    expect(fractionDivMod(makeFraction(2, 3), makeFraction(1, 3))).toEqual({
      offset: 2,
      remainder: { numerator: 0, denominator: 1 },
    })
  })

  it('splits 0 by any unit into offset 0 and a zero remainder', () => {
    expect(fractionDivMod(ZERO, makeFraction(1, 3))).toEqual({
      offset: 0,
      remainder: { numerator: 0, denominator: 1 },
    })
  })
})
