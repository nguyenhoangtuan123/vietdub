import { HomeClient } from "@/components/HomeClient";

export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-2xl text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl sm:leading-[1.1]">
          Lồng tiếng Việt cho video Trung Quốc
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-base text-muted sm:text-lg">
          Thả video Douyin, Bilibili vào đây. VietDub tự chép lời, dịch sang tiếng Việt, đọc giọng và ghép lại thành
          video hoàn chỉnh kèm phụ đề.
        </p>
      </section>
      <HomeClient />
    </>
  );
}
