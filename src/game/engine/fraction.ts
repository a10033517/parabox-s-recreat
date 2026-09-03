export interface Fraction {
  numerator: number
  denominator: number
}

function gcd(a: number, b: number): number {
  let x = a
  let y = b
  while (y !== 0) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

export function makeFraction(n: number, d: number): Fraction {
  if (d === 0) throw new Error('Fraction denominator cannot be zero')
  const sign = d < 0 ? -1 : 1
  const num = n * sign
  const den = d * sign
  if (num === 0) return { numerator: 0, denominator: 1 }
  const g = gcd(Math.abs(num), den)
  return { numerator: num / g, denominator: den / g }
}

export function addInt(f: Fraction, n: number): Fraction {
  return makeFraction(f.numerator + n * f.denominator, f.denominator)
}

export function divideByInt(f: Fraction, n: number): Fraction {
  return makeFraction(f.numerator, f.denominator * n)
}

export function multiplyByInt(f: Fraction, n: number): Fraction {
  return makeFraction(f.numerator * n, f.denominator)
}

export function isZero(f: Fraction): boolean {
  return f.numerator === 0
}

export function fractionDivMod(f: Fraction, unit: Fraction): { offset: number; remainder: Fraction } {
  const quotientNumerator = f.numerator * unit.denominator
  const quotientDenominator = f.denominator * unit.numerator
  const offset = Math.floor(quotientNumerator / quotientDenominator)
  const remainder = makeFraction(
    f.numerator * unit.denominator - offset * unit.numerator * f.denominator,
    f.denominator * unit.denominator,
  )
  return { offset, remainder }
}

export const ZERO: Fraction = makeFraction(0, 1)
export const HALF: Fraction = makeFraction(1, 2)
export const ONE: Fraction = makeFraction(1, 1)
