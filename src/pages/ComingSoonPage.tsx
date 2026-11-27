import { Hammer } from "lucide-react";

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
        <Hammer className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mt-1.5 text-sm text-gray-500">即将上线，将在下一阶段完整接入。</p>
    </div>
  );
}
