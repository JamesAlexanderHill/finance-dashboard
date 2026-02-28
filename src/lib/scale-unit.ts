export default function scaleUnit(value: bigint, exponent: number): number {
    const scaledValue = Number(value) / 10 ** exponent;

    return scaledValue;
}
