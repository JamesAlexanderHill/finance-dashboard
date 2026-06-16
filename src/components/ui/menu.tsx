"use client"

import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import cn from "~/lib/class-merge"

function Menu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root {...props} />
}

function MenuTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" className={className} {...props} />
}

function MenuPopup({ className, children, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={4} align="start" className="z-50 outline-none">
        <MenuPrimitive.Popup
          data-slot="menu-popup"
          className={cn(
            "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-md shadow-lg p-1 min-w-[12rem] data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0",
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 text-sm rounded cursor-pointer text-gray-700 dark:text-gray-300 data-highlighted:bg-gray-50 dark:data-highlighted:bg-gray-800 outline-none",
        className,
      )}
      {...props}
    />
  )
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="menu-separator"
      className={cn("my-1 h-px bg-gray-200 dark:bg-gray-800", className)}
      {...props}
    />
  )
}

export { Menu, MenuTrigger, MenuPopup, MenuItem, MenuSeparator }
