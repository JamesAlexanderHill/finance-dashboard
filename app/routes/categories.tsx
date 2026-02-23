import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/start";
import { eq, isNull, and } from "drizzle-orm";
import { z } from "zod";
import { useState } from "react";

// ── Server functions ──────────────────────────────────────────────────────────

const getCategories = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await import("../db");
  const { categories, users } = await import("../db/schema");

  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) return [];

  return db
    .select()
    .from(categories)
    .where(eq(categories.userId, user.id))
    .orderBy(categories.normalizedName);
});

const createCategory = createServerFn({ method: "POST" })
  .validator(
    z.object({ name: z.string().min(1), parentId: z.string().nullable() }),
  )
  .handler(async ({ data }) => {
    const { db } = await import("../db");
    const { categories, users } = await import("../db/schema");

    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    if (!user) throw new Error("No user");

    const normalizedName = data.name.trim().toLowerCase().replace(/\s+/g, " ");

    await db.insert(categories).values({
      userId: user.id,
      parentId: data.parentId,
      name: data.name.trim(),
      normalizedName,
    });
  });

const deleteCategory = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const { db } = await import("../db");
    const { categories } = await import("../db/schema");

    await db.delete(categories).where(eq(categories.id, data.id));
  });

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/categories")({
  loader: () => getCategories(),
  component: CategoriesPage,
});

type Category = Awaited<ReturnType<typeof getCategories>>[number];

function buildTree(
  cats: Category[],
): Array<Category & { children: Category[] }> {
  const map = new Map<string, Category & { children: Category[] }>();
  for (const c of cats) {
    map.set(c.id, { ...c, children: [] });
  }
  const roots: Array<Category & { children: Category[] }> = [];
  for (const node of map.values()) {
    if (!node.parentId) {
      roots.push(node);
    } else {
      const parent = map.get(node.parentId);
      if (parent) parent.children.push(node);
    }
  }
  return roots;
}

function CategoryNode({
  node,
  allCategories,
  depth = 0,
  onRefresh,
}: {
  node: Category & { children: Array<Category & { children: Category[] }> };
  allCategories: Category[];
  depth?: number;
  onRefresh: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  async function handleCreate() {
    if (!newName.trim()) return;
    await createCategory({ data: { name: newName, parentId: node.id } });
    setNewName("");
    setAdding(false);
    onRefresh();
  }

  async function handleDelete() {
    if (node.children.length > 0) {
      alert("Cannot delete a category that has children.");
      return;
    }
    if (!confirm(`Delete "${node.name}"?`)) return;
    await deleteCategory({ data: { id: node.id } });
    onRefresh();
  }

  return (
    <li>
      <div
        className="flex items-center gap-2 py-1"
        style={{ paddingLeft: `${depth * 20}px` }}
      >
        <span className="text-sm">{node.name}</span>
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-blue-500 hover:text-blue-700"
        >
          + child
        </button>
        <button
          onClick={handleDelete}
          className="text-xs text-red-400 hover:text-red-600"
        >
          delete
        </button>
      </div>

      {adding && (
        <div className="flex gap-2 items-center" style={{ paddingLeft: `${(depth + 1) * 20}px` }}>
          <input
            className="text-sm border border-gray-300 rounded px-2 py-1 flex-1"
            placeholder="Category name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <button
            onClick={handleCreate}
            className="text-xs bg-blue-600 text-white px-2 py-1 rounded"
          >
            Add
          </button>
          <button
            onClick={() => setAdding(false)}
            className="text-xs text-gray-500"
          >
            Cancel
          </button>
        </div>
      )}

      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <CategoryNode
              key={child.id}
              node={child}
              allCategories={allCategories}
              depth={depth + 1}
              onRefresh={onRefresh}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function CategoriesPage() {
  const cats = Route.useLoaderData();
  const navigate = Route.useNavigate();
  const [newRootName, setNewRootName] = useState("");

  const tree = buildTree(cats);

  async function handleCreateRoot() {
    if (!newRootName.trim()) return;
    await createCategory({ data: { name: newRootName, parentId: null } });
    setNewRootName("");
    navigate({ to: "/categories" });
  }

  function refresh() {
    navigate({ to: "/categories" });
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-4">Categories</h1>

      {tree.length === 0 ? (
        <p className="text-gray-500 mb-4">No categories yet.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
          <ul className="space-y-0.5">
            {tree.map((node) => (
              <CategoryNode
                key={node.id}
                node={node}
                allCategories={cats}
                onRefresh={refresh}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Add root category */}
      <div className="flex gap-2">
        <input
          className="text-sm border border-gray-300 rounded px-3 py-1.5 flex-1"
          placeholder="New root category name"
          value={newRootName}
          onChange={(e) => setNewRootName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreateRoot()}
        />
        <button
          onClick={handleCreateRoot}
          className="text-sm bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700"
        >
          Add
        </button>
      </div>
    </div>
  );
}
