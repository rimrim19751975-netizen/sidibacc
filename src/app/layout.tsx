import type { Metadata } from "next";
import "./globals.css";

// واجهة عربية RTL بالكامل — lang=ar و dir=rtl من اللحظة الأولى
export const metadata: Metadata = {
  title: "MCP Media Generator — لوحة الإدارة",
  description:
    "خادم MCP لتوليد الصور والفيديو بالذكاء الاصطناعي ودمج المقاطع — مع لوحة إدارة عربية للمفاتيح والمهام وربط العملاء.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {/* خط عربي جيد — يُحمَّل من المتصفح دون أي اعتمادية وقت البناء.
            eslint-disable: القاعدة موجهة لـ pages router؛ هنا في App Router
            ترويسة الجذر تنطبق على كل الصفحات تلقائيًا فلا مشكلة أصلًا. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased bg-slate-100 text-slate-900 font-[Tajawal,'Segoe_UI',Tahoma,sans-serif]">
        {children}
      </body>
    </html>
  );
}
