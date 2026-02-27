type BadgeProps = {
    color?: 'blue' | 'green' | 'red' | 'yellow' | 'gray'
    children: React.ReactNode
}

const classLookup = {
    blue: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300',
    green: 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300',
    red: 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300',
    yellow: 'bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300',
    gray: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
}

export default function Badge({ color = 'blue', children }: BadgeProps) {
    return (
        <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${classLookup[color]}`}>
            {children}
        </span>
    )
}
