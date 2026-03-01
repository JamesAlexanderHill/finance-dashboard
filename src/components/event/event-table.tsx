import type { Instrument, DecoratedEvent } from "~/db/types";
import Table, { ColumnDef, PaginationInfo } from "../ui/table";
import formatDate from "~/lib/format-date";
import Badge from "../ui/badge";
import { formatChange } from "~/lib/format";

type EventTableProps = {
    events: DecoratedEvent[],
    hideColumns?: string[],
    pagination: PaginationInfo,
    onPaginationChange?: (pagination: { page: number; pageSize: number }) => void
    onRowClick?: (row: DecoratedEvent) => void,
}

export default function EventTable({
    events,
    pagination,
    hideColumns = [],
    onRowClick,
    onPaginationChange,
}: EventTableProps) {
    const columns: ColumnDef<typeof events[number]>[] = [
        {
            id: 'date',
            header: 'Date',
            cell: ({ row }) => (
                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {formatDate(row.original.effectiveAt)}
                </span>
            ),
        },
        {
            id: 'account',
            header: 'Account',
            cell: ({ row }) => (
                <span className="text-gray-500 dark:text-gray-400 text-xs truncate max-w-[8rem]">
                {row.original.account.name ?? '—'}
                </span>
            )
        },
        {
            id: 'description',
            header: 'Description',
            cell: ({ row }) => (
                <span className="text-gray-900 dark:text-gray-100 font-medium">
                    {row.original.description}
                </span>
            ),
        },
        {
            id: 'change',
            header: 'Change',
            cell: ({ row }) => {
                // show a ticker badge with with the net change (reg/green)
                const instrumentNetChange: Record<string, [Instrument, bigint]> = row.original.legs.reduce((acc, leg) => {
                    const instrumentId = leg.instrumentId;

                    acc[instrumentId] = [leg.instrument, (acc[instrumentId]?.[1] ?? BigInt(0)) + leg.unitCount];
                    return acc;
                }, {} as Record<string, [Instrument, bigint]>);

                return (
                    <div>
                        {Object.entries(instrumentNetChange).map(([instrumentId, [instrument, totalUnitCount]]) => {
                            if (!instrument) return null;

                            const neg = totalUnitCount < 0;

                            return (
                                <Badge key={instrumentId} color={neg ? 'red' : 'green'}>{formatChange(totalUnitCount, instrument)}</Badge>
                            );
                        })}
                    </div>
                )
            },
        },
    ];

    return (
        <Table
            data={events}
            columns={columns}
            onRowClick={onRowClick}
            getRowId={(row) => row.id}
            showColumnVisibilityToggle={true} // show column toggle dropdown
            pagination={pagination}
            onPaginationChange={onPaginationChange}
            initialColumnVisibility={hideColumns.reduce((acc, columnId) => {
                acc[columnId] = false;
                return acc;
            }, {} as Record<string, boolean>)}
        >
            <p>No events yet.</p>
        </Table>
    );
}
