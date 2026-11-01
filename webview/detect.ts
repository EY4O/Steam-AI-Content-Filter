/**
 * Detecting the "AI Generated Content Disclosure" on a Steam store page.
 *
 * Steam renders both the Mature Content Description and the AI disclosure as
 * `<div id="game_area_content_descriptors"><h2>…</h2>`, and the heading is
 * localised. Neither appdetails nor IStoreBrowseService expose the disclosure,
 * so the store page HTML is the only source.
 */

// Headings as Steam serves them, one per store language (collected 2026-11-01).
const AI_HEADINGS = new Set([
	'AI Generated Content Disclosure', // english
	'تنويه بأن هذا محتوى مولد بالذكاء الاصطناعي', // arabic
	'Оповестяване за съдържание, генерирано от ИИ', // bulgarian
	'AI 生成内容披露', // schinese
	'AI 生成內容聲明', // tchinese
	'Informace o obsahu vytvářeném AI', // czech
	'Meddelelse om AI-genereret indhold', // danish
	'Informatie over door AI gegenereerde inhoud', // dutch
	'Tiedote tekoälysisällöstä', // finnish
	'Notification de contenu généré par IA', // french
	'Offenlegung von KI-generierten Inhalten', // german
	'Γνωστοποίηση περιεχομένου που δημιουργήθηκε από τεχνητή νοημοσύνη (AI)', // greek
	'Nyilatkozat MI generálta tartalomról', // hungarian
	'Pernyataan Konten Buatan AI', // indonesian
	"Divulgazione dei contenuti generati dall'IA", // italian
	'AI生成コンテンツの開示', // japanese
	'AI 생성 콘텐츠 사용 공개', // koreana
	'Opplysning om AI-generert innhold', // norwegian
	'Oświadczenie w sprawie treści generowanych przez SI', // polish
	'Divulgação de conteúdo gerado por IA', // portuguese, brazilian
	'Informații despre conținutul generat de IA', // romanian
	'Информация об ИИ-контенте', // russian
	'Información sobre contenido generado por IA', // spanish, latam
	'Upplysning om AI-genererat innehåll', // swedish
	'การเปิดเผยข้อมูลเกี่ยวกับเนื้อหาที่สร้างด้วย AI', // thai
	'Yapay Zekâ İçeriği Açıklaması', // turkish
	'Розкриття інформації щодо вмісту, згенерованого ШІ', // ukrainian
	'Công bố về nội dung tạo bởi AI', // vietnamese
]);

const MATURE_HEADINGS = new Set([
	'Mature Content Description',
	'وصف محتوى البالغين',
	'Описание на съдържание за възрастни',
	'成人内容描述',
	'成人內容說明',
	'Popis obsahu pro dospělé',
	'Beskrivelse af voksenindhold',
	'Beschrijving inhoud voor volwassenen',
	'Aikuissisällön kuvaus',
	'Description du contenu pour adultes',
	'Beschreibung nicht jugendfreier Inhalte',
	'Περιγραφή περιεχομένου για ώριμο κοινό',
	'Felnőtt tartalom leírása',
	'Deskripsi Konten Dewasa',
	'Descrizione del contenuto per adulti',
	'大人向けコンテンツの説明',
	'성인 콘텐츠 설명',
	'Beskrivelse av voksent innhold',
	'Opis dotyczący treści dla dorosłych',
	'Descrição de conteúdo para adultos',
	'Descrição do conteúdo adulto',
	'Descrierea conținutului destinat publicului matur',
	'Описание контента для взрослых',
	'Descripción del contenido para adultos',
	'Beskrivning av vuxet innehåll',
	'คำอธิบายเนื้อหาสำหรับผู้ใหญ่',
	'Yetişkin İçerik Açıklaması',
	'Опис вмісту для дорослих',
	'Mô tả nội dung mang yếu tố trưởng thành',
]);

// Fallback if Steam rewords a heading: the AI abbreviation or word in each language.
const AI_HINT = /(^|[^\p{L}])(AI|IA|KI|SI|MI|ИИ|ШІ)([^\p{L}]|$)|tekoäly|الذكاء|生成/u;

const DESCRIPTOR_HEADING = /id="game_area_content_descriptors"[^>]*>\s*<h2>([^<]*)<\/h2>/g;

function decodeEntities(text: string): string {
	const el = document.createElement('textarea');
	el.innerHTML = text;
	return el.value;
}

export function isAiHeading(raw: string): boolean {
	const heading = decodeEntities(raw).replace(/\s+/g, ' ').trim();
	if (AI_HEADINGS.has(heading)) return true;
	if (MATURE_HEADINGS.has(heading)) return false;
	return AI_HINT.test(heading);
}

export function headingsFromHtml(html: string): string[] {
	return [...html.matchAll(DESCRIPTOR_HEADING)].map((m) => m[1]);
}

/** True for the age-verification page Steam serves instead of the store page. */
export function isAgeGate(url: string, html: string): boolean {
	return url.includes('/agecheck/') || html.includes('id="app_agegate"');
}

/** The developer's own description from the AI disclosure on the current page, if any. */
export function disclosureFromDocument(doc: Document): { found: boolean; text: string } {
	for (const block of doc.querySelectorAll<HTMLElement>('[id="game_area_content_descriptors"]')) {
		const h2 = block.querySelector('h2');
		if (h2 && isAiHeading(h2.textContent ?? '')) {
			const text = block.querySelector('i')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
			return { found: true, text };
		}
	}
	return { found: false, text: '' };
}
