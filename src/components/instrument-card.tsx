import { Link } from "@tanstack/react-router";
import type { Instrument, Account } from "~/db/schema";
import Badge from "~/components/ui/badge";
import { formatBalance } from "~/lib/format";
import { formatMajorAmount } from "~/lib/format-currency";
import scaleUnit from "~/lib/scale-unit";

type InstrumentCardProps = {
    instrument: Instrument;
    account: Account;
    balance: bigint;
    isDefault?: boolean;
    /** 1 unit of `instrument` = `rate` units of `homeCurrencyCode`. */
    rate: number;
    homeCurrencyCode: string;
}

export default function InstrumentCard({
    instrument,
    account,
    isDefault = false,
    balance,
    rate,
    homeCurrencyCode,
}: InstrumentCardProps) {
    const isNegative = balance < 0;

    return (
        <Link
            key={instrument.id}
            to="/accounts/$accountId/instruments/$instrumentId"
            params={{ accountId: account.id, instrumentId: instrument.id }}
            className="flex-shrink-0 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
        >
            <div className="flex items-start justify-between">
                <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                    {instrument.ticker}
                    {isDefault && (
                        <Badge className="ml-2">Default</Badge>
                    )}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{instrument.name}</p>
                </div>
            </div>
            <p
                className={[
                    'mt-2 text-lg font-semibold tabular-nums',
                    isNegative ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100',
                ].join(' ')}
            >
                {formatBalance(balance, instrument)}
            </p>
            {instrument.ticker !== homeCurrencyCode && (
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {formatMajorAmount(scaleUnit(balance, instrument.exponent) * rate, homeCurrencyCode)}
                </p>
            )}
        </Link>
    )
}