import * as React from 'react'
import { ACCOUNT_COLORS, type AccountColorName } from '~/lib/chart-colors'
import { COLOR_CLASSES } from '~/components/charts'

/** A color <select> for an account's base chart hue, with a swatch preview. */
export default function AccountColorSelect({
  name,
  defaultValue,
}: {
  name: string
  defaultValue: AccountColorName | null
}) {
  const [value, setValue] = React.useState<AccountColorName | ''>(defaultValue ?? '')

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Chart color</label>
      <div className="flex items-center gap-2">
        {value && <span className={`inline-block w-3 h-3 rounded-full shrink-0 ${COLOR_CLASSES[`${value}-2`].bg}`} />}
        <select
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value as AccountColorName | '')}
          className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Auto</option>
          {ACCOUNT_COLORS.map((color) => (
            <option key={color} value={color}>
              {color}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
