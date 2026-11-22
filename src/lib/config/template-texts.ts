// Texts of the project templates in every UI language. The structure of the
// documents lives in templates.ts; here is only what a translator changes.

export type Lang = "de" | "en" | "fr" | "es" | "it" | "pt" | "nl" | "pl" | "ru" | "zh" | "ja";

export interface ArticleText {
  title: string;
  intro: string;
  body: string;
}

export const ARTICLE: Record<Lang, ArticleText> = {
  de: {
    title: "Titel des Dokuments",
    intro: "Einleitung",
    body: "Willkommen in Gilgamesh! Links steht der Quelltext, rechts die Vorschau.",
  },
  en: {
    title: "Document title",
    intro: "Introduction",
    body: "Welcome to Gilgamesh! The source is on the left, the preview on the right.",
  },
  fr: {
    title: "Titre du document",
    intro: "Introduction",
    body: "Bienvenue dans Gilgamesh ! Le code source est à gauche, l'aperçu à droite.",
  },
  es: {
    title: "Título del documento",
    intro: "Introducción",
    body: "¡Bienvenido a Gilgamesh! El código fuente está a la izquierda y la vista previa a la derecha.",
  },
  it: {
    title: "Titolo del documento",
    intro: "Introduzione",
    body: "Benvenuto in Gilgamesh! Il sorgente è a sinistra, l'anteprima a destra.",
  },
  pt: {
    title: "Título do documento",
    intro: "Introdução",
    body: "Bem-vindo ao Gilgamesh! O código-fonte está à esquerda e a pré-visualização à direita.",
  },
  nl: {
    title: "Titel van het document",
    intro: "Inleiding",
    body: "Welkom bij Gilgamesh! Links staat de broncode, rechts de voorvertoning.",
  },
  pl: { title: "Tytuł dokumentu", intro: "Wstęp", body: "Witaj w Gilgamesh! Po lewej stronie jest kod źródłowy, po prawej podgląd." },
  ru: {
    title: "Название документа",
    intro: "Введение",
    body: "Добро пожаловать в Gilgamesh! Слева исходный текст, справа предварительный просмотр.",
  },
  zh: { title: "文档标题", intro: "引言", body: "欢迎使用 Gilgamesh！左侧是源代码，右侧是预览。" },
  ja: { title: "文書のタイトル", intro: "はじめに", body: "Gilgamesh へようこそ！左側にソース、右側にプレビューが表示されます。" },
};

export interface PresentationText {
  title: string;
  first: string;
  points: [string, string];
}

export const PRESENTATION: Record<Lang, PresentationText> = {
  de: { title: "Titel der Präsentation", first: "Erste Folie", points: ["Erster Punkt", "Zweiter Punkt"] },
  en: { title: "Presentation title", first: "First slide", points: ["First point", "Second point"] },
  fr: { title: "Titre de la présentation", first: "Première diapositive", points: ["Premier point", "Deuxième point"] },
  es: { title: "Título de la presentación", first: "Primera diapositiva", points: ["Primer punto", "Segundo punto"] },
  it: { title: "Titolo della presentazione", first: "Prima diapositiva", points: ["Primo punto", "Secondo punto"] },
  pt: { title: "Título da apresentação", first: "Primeiro diapositivo", points: ["Primeiro ponto", "Segundo ponto"] },
  nl: { title: "Titel van de presentatie", first: "Eerste dia", points: ["Eerste punt", "Tweede punt"] },
  pl: { title: "Tytuł prezentacji", first: "Pierwszy slajd", points: ["Pierwszy punkt", "Drugi punkt"] },
  ru: { title: "Название презентации", first: "Первый слайд", points: ["Первый пункт", "Второй пункт"] },
  zh: { title: "演示文稿标题", first: "第一张幻灯片", points: ["第一点", "第二点"] },
  ja: { title: "プレゼンテーションのタイトル", first: "最初のスライド", points: ["一つ目のポイント", "二つ目のポイント"] },
};

export interface LetterText {
  /** scrlttr2's letter option (`\LoadLetterOption`): page layout and address window of the country. */
  layout: string;
  /** Class options the layout needs, e.g. US letter paper. */
  classOptions?: string;
  opening: string;
  closing: string;
  body: string;
  /** Lines separated by \\. */
  to: string;
  subject: string;
}

export const LETTER: Record<Lang, LetterText> = {
  de: {
    layout: "DIN",
    opening: "Sehr geehrte Damen und Herren,",
    closing: "Mit freundlichen Grüßen",
    body: "hier steht der Text des Briefes.",
    to: String.raw`Empfänger\\Straße 1\\12345 Ort`,
    subject: "Betreff",
  },
  en: {
    layout: "UScommercial9",
    classOptions: "paper=letter",
    opening: "Dear Sir or Madam,",
    closing: "Yours faithfully,",
    body: "this is where the letter text goes.",
    to: String.raw`Recipient\\1 Street\\Town`,
    subject: "Subject",
  },
  fr: {
    layout: "NF",
    opening: "Madame, Monsieur,",
    closing: "Veuillez agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
    body: "voici le texte de la lettre.",
    to: String.raw`Destinataire\\1 rue Exemple\\75000 Ville`,
    subject: "Objet",
  },
  es: {
    layout: "DIN",
    opening: "Estimados señores:",
    closing: "Atentamente,",
    body: "Aquí va el texto de la carta.",
    to: String.raw`Destinatario\\Calle Ejemplo 1\\28000 Ciudad`,
    subject: "Asunto",
  },
  it: {
    layout: "DIN",
    opening: "Gentili Signore e Signori,",
    closing: "Distinti saluti",
    body: "qui va il testo della lettera.",
    to: String.raw`Destinatario\\Via Esempio 1\\00100 Città`,
    subject: "Oggetto",
  },
  pt: {
    layout: "DIN",
    opening: "Exmos. Senhores,",
    closing: "Com os melhores cumprimentos,",
    body: "aqui fica o texto da carta.",
    to: String.raw`Destinatário\\Rua Exemplo 1\\1000-001 Cidade`,
    subject: "Assunto",
  },
  nl: {
    layout: "DIN",
    opening: "Geachte heer, mevrouw,",
    closing: "Met vriendelijke groet,",
    body: "hier staat de tekst van de brief.",
    to: String.raw`Ontvanger\\Voorbeeldstraat 1\\1234 AB Plaats`,
    subject: "Onderwerp",
  },
  pl: {
    layout: "DIN",
    opening: "Szanowni Państwo,",
    closing: "Z wyrazami szacunku",
    body: "tutaj znajduje się treść listu.",
    to: String.raw`Odbiorca\\ul. Przykładowa 1\\00-001 Miasto`,
    subject: "Temat",
  },
  ru: {
    layout: "DIN",
    opening: "Уважаемые дамы и господа!",
    closing: "С уважением,",
    body: "Здесь находится текст письма.",
    to: String.raw`Получатель\\ул. Примерная, д. 1\\123456 Город`,
    subject: "Тема",
  },
  zh: {
    layout: "DIN",
    opening: "尊敬的先生/女士：",
    closing: "此致敬礼",
    body: "这里是信件正文。",
    to: String.raw`收件人\\示例路 1 号\\100000 城市`,
    subject: "主题",
  },
  ja: {
    layout: "DIN",
    opening: "拝啓",
    closing: "敬具",
    body: "こちらに手紙の本文を書きます。",
    to: String.raw`宛先\\例町 1-1\\100-0001 市`,
    subject: "件名",
  },
};

/** Comments in the thesis files. */
export interface ThesisComments {
  tables: string;
  accent: string;
  vector: string;
  mono: string;
  listings: string;
  spacing: string;
  toc: string;
  formulas: string;
  titleDetails: string;
  header: string;
  cref: string;
  confidential: string;
  logo: string;
  logoUse: (path: string) => string;
  shield: string;
  star: string;
  book: string;
  divider: string;
  wordmark: string;
  acronymHelp: string;
  acronymLayout: string;
  compact: string;
  glossaryLayout: string;
  bold: string;
  addAll: string;
  /** Comment above the language setup where it needs one (fonts, French colons). */
  languageNote: string;
}

export interface ThesisText {
  title: string;
  author: string;
  type: string;
  course: string;
  department: string;
  expert: string;
  locationdate: string;
  first: string;
  second: string;
  /** Headings of the directories; for the lists of figures and tables the ones babel, ctex or the preamble print. */
  bib: string;
  figures: string;
  tables: string;
  formulas: string;
  acronyms: string;
  glossary: string;
  /** cleveref's name for sections in the appendix, singular and plural. */
  appendixName: [string, string];
  /**
   * Names for figures, tables and equations (singular, plural) in languages cleveref
   * has none for; `null` where it has them, which are then written out (noabbrev).
   */
  refs: [[string, string], [string, string], [string, string]] | null;
  /** End of the logo's motto line. */
  founded: string;
  /** The example \newacronym. */
  acronym: string;
  /** The example \newglossaryentry. */
  glossaryEntry: string;
  abstract: string;
  /** The example section; `image` is the path of the picture in its commented-out \includegraphics. */
  example: (image: string) => string;
  imageName: string;
  appendix: string;
  declaration: string;
  confidentiality: string;
  c: ThesisComments;
}

const confidentiality = (title: string, paragraphs: [string, string, string]) => String.raw`\section*{${title}}
\addcontentsline{toc}{section}{${title}}

${paragraphs[0]}
\medskip

${paragraphs[1]}
\medskip

${paragraphs[2]}
`;

/** Lines for place, date and signature that fit the text width also with longer words ("Handtekening:"). */
const signatures = (place: string, signature: string) =>
  String.raw`${place} \underline{\hspace{4.5cm}} \hfill ${signature} \underline{\hspace{4.5cm}}`;

const declaration = (title: string, text: string, signatureLine: string) => String.raw`\thispagestyle{empty}
\section*{${title}}

${text}

\vspace{2cm}

${signatureLine}
`;

const appendix = (title: string, label: string, text: string) => String.raw`\section{${title}}
\label{sec:${label}}

${text}
`;

/** Abstract in the document's language followed by the English one, as many universities ask for. */
const abstract = (title: string, text: string, english: string) => String.raw`\phantomsection
\addcontentsline{toc}{section}{${title}}
\section*{${title}}
${text}

\phantomsection
\addcontentsline{toc}{section}{Abstract}
\section*{Abstract}
${english}
`;

interface ExampleText {
  section: string;
  label: string;
  intro: string;
  paragraph: string;
  formulas: string;
  formulasText: string;
  formulaEntry: string;
  figures: string;
  placeholder: string;
  figureCaption: string;
  tableCaption: string;
  head: string;
  id: string;
}

const example = (e: ExampleText) => (image: string) => String.raw`\section{${e.section}}
\label{sec:${e.label}}

${e.intro}
\medskip

${e.paragraph}

\subsection{${e.formulas}}
${e.formulasText}
\begin{equation}
  E = mc^2
  \formelentry{${e.formulaEntry}}
  \label{eq:${e.label}}
\end{equation}

\subsection{${e.figures}}
\begin{figure}[H]
  \centering
  \fbox{\parbox[c][4cm][c]{0.6\textwidth}{\centering ${e.placeholder}}}
  % \includegraphics[width=0.8\textwidth]{${image}}
  \caption{${e.figureCaption}}
  \label{fig:${e.label}}
\end{figure}

\begin{table}[H]
  \centering
  \caption{${e.tableCaption}}
  \label{tab:${e.label}}
  \begin{tabularx}{0.8\textwidth}{lX}
    \toprule
    ${e.head} \\
    \midrule
    \code{id} & ${e.id} \\
    \bottomrule
  \end{tabularx}
\end{table}
`;

const glossaryEntry = (name: string, description: string) => String.raw`\newglossaryentry{utnapishtim}{
  name={${name}},
  description={${description}}
}`;

export const THESIS: Record<Lang, ThesisText> = {
  de: {
    title: "Eine Vorlage für Gilgamesh",
    author: "Vorname Nachname",
    type: "Abschlussarbeit",
    course: "Studiengang",
    department: "Fachbereich I",
    expert: "Prof. Dr. Beispiel",
    locationdate: "Ort, Datum",
    first: "Erstgutachter/in",
    second: "Zweitgutachter/in",
    bib: "Literaturverzeichnis",
    figures: "Abbildungsverzeichnis",
    tables: "Tabellenverzeichnis",
    formulas: "Formelverzeichnis",
    acronyms: "Abkürzungsverzeichnis",
    glossary: "Glossar",
    appendixName: ["Anhang", "Anhänge"],
    refs: null,
    founded: String.raw`gegr.\ 1888`,
    acronym: String.raw`\newacronym{ki}{KI}{Künstliche Intelligenz}`,
    glossaryEntry: String.raw`\newglossaryentry{utnapischtim}{
  name={Utnapischtim},
  description={Überlebender der Sintflut im Gilgamesch-Epos, dem die Götter Unsterblichkeit schenkten und den Gilgamesch auf der Suche nach ewigem Leben aufsucht}
}`,
    abstract: abstract(
      "Kurzfassung",
      "Kurze Zusammenfassung der Arbeit.",
      String.raw`\foreignlanguage{english}{A short summary of the thesis.}`,
    ),
    example: example({
      section: "Beispiel",
      label: "beispiel",
      intro: String.raw`Hier beginnt der Text. Abkürzungen werden mit \verb|\gls| gesetzt, beim ersten Mal ausgeschrieben: \gls{ki}.
Beim zweiten Mal erscheint nur noch die Abkürzung: \gls{ki}.
Quellen werden so zitiert \cite{knuth1984}, Querverweise so: \cref{fig:beispiel}, \cref{tab:beispiel}.`,
      paragraph: String.raw`Ein neuer Absatz wird durch eine Leerzeile und \verb|\medskip| abgesetzt.`,
      formulas: "Formeln",
      formulasText: String.raw`Gleichungen mit \verb|\formelentry| erscheinen im Formelverzeichnis (\cref{eq:beispiel}).`,
      formulaEntry: "Masse-Energie-Äquivalenz",
      figures: "Abbildungen und Tabellen",
      placeholder: "Abbildung",
      figureCaption: "Beispielabbildung",
      tableCaption: "Beispieltabelle",
      head: "Begriff & Bedeutung",
      id: "Eindeutige Kennung",
    }),
    imageName: "bild.png",
    appendix: appendix("Beispielanhang", "anhang", "Hier ist Platz für Anhang."),
    declaration: declaration(
      "Eidesstattliche Erklärung",
      `Hiermit versichere ich, dass ich die vorliegende Arbeit in allen Teilen selbstständig angefertigt und keine anderen als die in der Arbeit angegebenen Quellen und Hilfsmittel benutzt habe, und dass die Arbeit in gleicher oder ähnlicher Form in noch keiner anderen Prüfung vorgelegen hat.
Sämtliche wörtlichen oder sinngemäßen Übernahmen und Zitate, sowie alle Abschnitte, die mithilfe von KI-basierten Tools entworfen, verfasst und/oder bearbeitet wurden, sind kenntlich gemacht und nachgewiesen.`,
      String.raw`Ort, Datum: \underline{\hspace{5cm}} \hspace{1cm} Unterschrift: \underline{\hspace{5cm}}`,
    ),
    confidentiality: confidentiality("Sperrvermerk", [
      String.raw`Die vorliegende Arbeit mit dem Titel \enquote{\arbeitstitel} enthält vertrauliche Daten des Unternehmens [Unternehmen].`,
      `Diese Arbeit darf Dritten, mit Ausnahme der Gutachter und befugten Mitgliedern des Prüfungsausschusses,
ohne ausdrückliche Zustimmung des Unternehmens und des Verfassers nicht zugänglich gemacht werden.`,
      "Eine Vervielfältigung und Veröffentlichung der Arbeit ohne vorherige Genehmigung ist auch in Auszügen nicht erlaubt.",
    ]),
    c: {
      tables: "Tabellen",
      accent: "Akzentfarbe",
      vector: String.raw`Vektorgrafiken, z.\,B. das Logo auf dem Deckblatt`,
      mono: "Technische Bezeichner in Monospace",
      listings: String.raw`Quellcode-Listings, z.\,B. für den Anhang`,
      spacing: "Zeilen- und Absatzabstände, keine Einrückung",
      toc: "Inhaltsverzeichnis mit Punkten auch nach den Abschnitten",
      formulas: String.raw`Formelverzeichnis; Einträge mit \formelentry{Beschreibung} in der Gleichung`,
      titleDetails: "Angaben für das Deckblatt",
      header: "Kopfzeile im Textteil: aktueller Abschnitt, Seitenzahl unten",
      cref: String.raw`Querverweise mit \cref (nach hyperref laden)`,
      confidential: "bei Arbeiten mit vertraulichen Firmendaten",
      logo: `Ausgedachtes Logo der "Example University" (TikZ, Vektorgrafik)`,
      logoUse: (path) => String.raw`Einbinden mit \input{${path}}; benötigt tikz mit der Bibliothek shapes.geometric.`,
      shield: "Wappenschild",
      star: "Stern",
      book: "Aufgeschlagenes Buch",
      divider: "Trennlinie",
      wordmark: "Schriftzug",
      acronymHelp: String.raw`\newacronym{schlüssel}{Kurzform}{Langform}; erscheint im Verzeichnis, sobald \gls{schlüssel} verwendet wird`,
      acronymLayout: String.raw`Ab hier nur Darstellung. Die Datei wird in der Präambel geladen, \abkuerzungen gibt das Verzeichnis aus.`,
      compact: "Kompakte Liste ohne Zusatzabstände",
      glossaryLayout: String.raw`Ab hier nur Darstellung. Die Datei wird in der Präambel geladen, \glossar gibt das Glossar aus.`,
      bold: "Begriff fett, Erklärung direkt darunter",
      addAll: "Alle Begriffe aufnehmen, auch unbenutzte; nach der Ausgabe, sonst rutscht die Überschrift nach unten",
      languageNote: "",
    },
  },
  en: {
    title: "A template for Gilgamesh",
    author: "First name Last name",
    type: "Thesis",
    course: "Degree programme",
    department: "Department I",
    expert: "Prof. Dr. Example",
    locationdate: "Place, date",
    first: "First examiner",
    second: "Second examiner",
    bib: "Bibliography",
    figures: "List of Figures",
    tables: "List of Tables",
    formulas: "List of Equations",
    acronyms: "List of Abbreviations",
    glossary: "Glossary",
    appendixName: ["Appendix", "Appendices"],
    refs: null,
    founded: String.raw`est.\ 1888`,
    acronym: String.raw`\newacronym{ki}{AI}{Artificial Intelligence}`,
    glossaryEntry: glossaryEntry(
      "Utnapishtim",
      "Survivor of the flood in the Epic of Gilgamesh, granted immortality by the gods, whom Gilgamesh seeks out in his quest for eternal life",
    ),
    abstract: String.raw`\phantomsection
\addcontentsline{toc}{section}{Abstract}
\section*{Abstract}
A short summary of the thesis.
`,
    example: example({
      section: "Example",
      label: "example",
      intro: String.raw`The text starts here. Abbreviations use \verb|\gls| and are spelled out the first time: \gls{ki}.
The second time only the abbreviation appears: \gls{ki}.
Sources are cited like this \cite{knuth1984}, cross references like this: \cref{fig:example}, \cref{tab:example}.`,
      paragraph: String.raw`A new paragraph is set apart by an empty line and \verb|\medskip|.`,
      formulas: "Equations",
      formulasText: String.raw`Equations with \verb|\formelentry| appear in the list of equations (\cref{eq:example}).`,
      formulaEntry: "Mass-energy equivalence",
      figures: "Figures and tables",
      placeholder: "Figure",
      figureCaption: "Example figure",
      tableCaption: "Example table",
      head: "Term & Meaning",
      id: "Unique identifier",
    }),
    imageName: "picture.png",
    appendix: appendix("Example appendix", "appendix", "Room for the appendix."),
    declaration: declaration(
      "Declaration of Authorship",
      `I hereby declare that I have written this thesis independently and have not used any sources or aids other than those stated, and that the thesis has not been submitted in the same or a similar form for any other examination.
All verbatim or paraphrased quotations, as well as all sections drafted, written and/or edited with AI-based tools, are marked and referenced.`,
      signatures("Place, date:", "Signature:"),
    ),
    confidentiality: confidentiality("Confidentiality Notice", [
      String.raw`This thesis, titled \enquote{\arbeitstitel}, contains confidential data of [company].`,
      `It may not be made accessible to third parties, except the examiners and authorised members of the
examination board, without the express consent of the company and the author.`,
      "Copying or publishing this thesis, even in part, is not permitted without prior approval.",
    ]),
    c: {
      tables: "Tables",
      accent: "Accent colour",
      vector: "Vector graphics, e.g. the logo on the title page",
      mono: "Technical identifiers in monospace",
      listings: "Source code listings, e.g. for the appendix",
      spacing: "Line and paragraph spacing, no indentation",
      toc: "Dotted leaders in the table of contents for sections too",
      formulas: String.raw`List of equations; add entries with \formelentry{description} inside the equation`,
      titleDetails: "Title page details",
      header: "Header in the main part: current section, page number at the bottom",
      cref: String.raw`Cross references with \cref (load after hyperref)`,
      confidential: "for theses with confidential company data",
      logo: `Made-up logo of "Example University" (TikZ, vector graphic)`,
      logoUse: (path) => String.raw`Include with \input{${path}}; needs tikz with the shapes.geometric library.`,
      shield: "Shield",
      star: "Star",
      book: "Open book",
      divider: "Divider",
      wordmark: "Wordmark",
      acronymHelp: String.raw`\newacronym{key}{short}{long}; listed once \gls{key} is used`,
      acronymLayout: String.raw`Layout only from here. The file is loaded in the preamble, \abkuerzungen prints the list.`,
      compact: "Compact list without extra spacing",
      glossaryLayout: String.raw`Layout only from here. The file is loaded in the preamble, \glossar prints the glossary.`,
      bold: "Term in bold, explanation right below",
      addAll: "List all terms, even unused ones; after printing, otherwise the heading moves down",
      languageNote: "",
    },
  },
  fr: {
    title: "Un modèle pour Gilgamesh",
    author: "Prénom Nom",
    type: "Mémoire de fin d'études",
    course: "Filière",
    department: "Département I",
    expert: "Prof. Dr Exemple",
    locationdate: "Lieu, date",
    first: "Premier correcteur",
    second: "Second correcteur",
    bib: "Bibliographie",
    figures: "Table des figures",
    tables: "Liste des tableaux",
    formulas: "Liste des équations",
    acronyms: "Liste des abréviations",
    glossary: "Glossaire",
    appendixName: ["annexe", "annexes"],
    refs: null,
    founded: "fondée en 1888",
    acronym: String.raw`\newacronym{ki}{IA}{Intelligence artificielle}`,
    glossaryEntry: glossaryEntry(
      "Outnapishtim",
      "Survivant du Déluge dans l'Épopée de Gilgamesh, à qui les dieux accordèrent l'immortalité et que Gilgamesh va trouver dans sa quête de la vie éternelle",
    ),
    abstract: abstract("Résumé", "Bref résumé du mémoire.", String.raw`\foreignlanguage{english}{A short summary of the thesis.}`),
    example: example({
      section: "Exemple",
      label: "exemple",
      intro: String.raw`Le texte commence ici. Les abréviations s'écrivent avec \verb|\gls| et sont développées la première fois~: \gls{ki}.
La deuxième fois, seule l'abréviation apparaît~: \gls{ki}.
Les sources se citent ainsi \cite{knuth1984}, les renvois ainsi~: \cref{fig:exemple}, \cref{tab:exemple}.`,
      paragraph: String.raw`Un nouveau paragraphe est séparé par une ligne vide et \verb|\medskip|.`,
      formulas: "Formules",
      formulasText: String.raw`Les équations avec \verb|\formelentry| figurent dans la liste des équations (\cref{eq:exemple}).`,
      formulaEntry: "Équivalence masse-énergie",
      figures: "Figures et tableaux",
      placeholder: "Figure",
      figureCaption: "Figure d'exemple",
      tableCaption: "Tableau d'exemple",
      head: "Terme & Signification",
      id: "Identifiant unique",
    }),
    imageName: "image.png",
    appendix: appendix("Annexe d'exemple", "annexe", "Place réservée à l'annexe."),
    declaration: declaration(
      "Déclaration sur l'honneur",
      `Je déclare sur l'honneur avoir rédigé le présent travail de manière entièrement autonome, sans avoir utilisé d'autres sources ni d'autres moyens que ceux qui y sont indiqués, et que ce travail n'a pas été présenté, sous une forme identique ou similaire, dans le cadre d'un autre examen.
Toutes les reprises et citations, littérales ou reformulées, ainsi que toutes les parties conçues, rédigées et/ou retravaillées à l'aide d'outils fondés sur l'IA, sont signalées et référencées.`,
      signatures("Lieu, date~:", "Signature~:"),
    ),
    confidentiality: confidentiality("Clause de confidentialité", [
      String.raw`Le présent travail, intitulé \enquote{\arbeitstitel}, contient des données confidentielles de l'entreprise [entreprise].`,
      `Il ne peut être rendu accessible à des tiers, à l'exception des correcteurs et des membres habilités du jury,
sans l'accord exprès de l'entreprise et de l'auteur.`,
      "Toute reproduction ou publication du travail, même partielle, est interdite sans autorisation préalable.",
    ]),
    c: {
      tables: "Tableaux",
      accent: "Couleur d'accentuation",
      vector: "Graphiques vectoriels, p. ex. le logo de la page de titre",
      mono: "Identifiants techniques en police à chasse fixe",
      listings: "Listings de code source, p. ex. pour l'annexe",
      spacing: "Interlignes et espacement des paragraphes, sans alinéa",
      toc: "Points de conduite dans la table des matières, aussi pour les sections",
      formulas: String.raw`Liste des équations ; entrées avec \formelentry{description} dans l'équation`,
      titleDetails: "Informations pour la page de titre",
      header: "En-tête du corps du texte : section courante, numéro de page en bas",
      cref: String.raw`Renvois avec \cref (à charger après hyperref)`,
      confidential: "pour les travaux contenant des données confidentielles d'entreprise",
      logo: "Logo fictif de « Example University » (TikZ, graphique vectoriel)",
      logoUse: (path) => String.raw`À inclure avec \input{${path}} ; nécessite tikz avec la bibliothèque shapes.geometric.`,
      shield: "Écusson",
      star: "Étoile",
      book: "Livre ouvert",
      divider: "Ligne de séparation",
      wordmark: "Logotype",
      acronymHelp: String.raw`\newacronym{clé}{forme courte}{forme longue} ; apparaît dans la liste dès que \gls{clé} est utilisé`,
      acronymLayout: String.raw`À partir d'ici, mise en forme uniquement. Le fichier est chargé dans le préambule, \abkuerzungen affiche la liste.`,
      compact: "Liste compacte sans espacement supplémentaire",
      glossaryLayout: String.raw`À partir d'ici, mise en forme uniquement. Le fichier est chargé dans le préambule, \glossar affiche le glossaire.`,
      bold: "Terme en gras, explication juste en dessous",
      addAll: "Inclure tous les termes, même inutilisés ; après l'affichage, sinon le titre descend",
      languageNote: String.raw`babel-french rend « : » actif sous pdfLaTeX, ce qui casse \cref{fig:exemple} ; il reste donc un caractère ordinaire. Espace insécable avant « : » avec ~:, légendes « Figure 1 – … »`,
    },
  },
  es: {
    title: "Una plantilla para Gilgamesh",
    author: "Nombre Apellido",
    type: "Trabajo de fin de grado",
    course: "Titulación",
    department: "Departamento I",
    expert: "Prof. Dr. Ejemplo",
    locationdate: "Lugar, fecha",
    first: "Primer evaluador",
    second: "Segundo evaluador",
    bib: "Bibliografía",
    figures: "Índice de figuras",
    tables: "Índice de tablas",
    formulas: "Índice de ecuaciones",
    acronyms: "Lista de abreviaturas",
    glossary: "Glosario",
    appendixName: ["anexo", "anexos"],
    refs: null,
    founded: String.raw`fund.\ 1888`,
    acronym: String.raw`\newacronym{ki}{IA}{Inteligencia artificial}`,
    glossaryEntry: glossaryEntry(
      "Utnapishtim",
      "Superviviente del diluvio en la Epopeya de Gilgamesh, a quien los dioses concedieron la inmortalidad y a quien Gilgamesh visita en su búsqueda de la vida eterna",
    ),
    abstract: abstract("Resumen", "Breve resumen del trabajo.", String.raw`\foreignlanguage{english}{A short summary of the thesis.}`),
    example: example({
      section: "Ejemplo",
      label: "ejemplo",
      intro: String.raw`El texto empieza aquí. Las abreviaturas se escriben con \verb|\gls| y la primera vez aparecen desarrolladas: \gls{ki}.
La segunda vez solo aparece la abreviatura: \gls{ki}.
Las fuentes se citan así \cite{knuth1984} y las referencias cruzadas así: \cref{fig:ejemplo}, \cref{tab:ejemplo}.`,
      paragraph: String.raw`Un párrafo nuevo se separa con una línea en blanco y \verb|\medskip|.`,
      formulas: "Fórmulas",
      formulasText: String.raw`Las ecuaciones con \verb|\formelentry| aparecen en el índice de ecuaciones (\cref{eq:ejemplo}).`,
      formulaEntry: "Equivalencia masa-energía",
      figures: "Figuras y tablas",
      placeholder: "Figura",
      figureCaption: "Figura de ejemplo",
      tableCaption: "Tabla de ejemplo",
      head: "Término & Significado",
      id: "Identificador único",
    }),
    imageName: "imagen.png",
    appendix: appendix("Anexo de ejemplo", "anexo", "Espacio para el anexo."),
    declaration: declaration(
      "Declaración de autoría",
      `Por la presente declaro que he elaborado este trabajo de forma totalmente independiente, sin utilizar fuentes ni medios distintos de los indicados en él, y que el trabajo no ha sido presentado, en la misma forma o en una similar, en ningún otro examen.
Todas las citas y reproducciones, literales o parafraseadas, así como todas las partes concebidas, redactadas y/o editadas con herramientas basadas en IA, están señaladas y documentadas.`,
      signatures("Lugar y fecha:", "Firma:"),
    ),
    confidentiality: confidentiality("Cláusula de confidencialidad", [
      String.raw`El presente trabajo, titulado \enquote{\arbeitstitel}, contiene datos confidenciales de la empresa [empresa].`,
      `No podrá ponerse a disposición de terceros, con excepción de los evaluadores y de los miembros autorizados del tribunal,
sin el consentimiento expreso de la empresa y del autor.`,
      "Queda prohibida la reproducción o publicación del trabajo, incluso parcial, sin autorización previa.",
    ]),
    c: {
      tables: "Tablas",
      accent: "Color de acento",
      vector: "Gráficos vectoriales, p. ej. el logotipo de la portada",
      mono: "Identificadores técnicos en monoespaciado",
      listings: "Listados de código fuente, p. ej. para el anexo",
      spacing: "Interlineado y espaciado entre párrafos, sin sangría",
      toc: "Puntos guía en el índice también para las secciones",
      formulas: String.raw`Índice de ecuaciones; entradas con \formelentry{descripción} dentro de la ecuación`,
      titleDetails: "Datos de la portada",
      header: "Encabezado en el cuerpo del texto: sección actual, número de página abajo",
      cref: String.raw`Referencias cruzadas con \cref (cargar después de hyperref)`,
      confidential: "para trabajos con datos confidenciales de empresa",
      logo: `Logotipo ficticio de "Example University" (TikZ, gráfico vectorial)`,
      logoUse: (path) => String.raw`Se incluye con \input{${path}}; requiere tikz con la biblioteca shapes.geometric.`,
      shield: "Escudo",
      star: "Estrella",
      book: "Libro abierto",
      divider: "Línea divisoria",
      wordmark: "Logotipo",
      acronymHelp: String.raw`\newacronym{clave}{forma corta}{forma larga}; aparece en la lista en cuanto se usa \gls{clave}`,
      acronymLayout: String.raw`A partir de aquí, solo formato. El archivo se carga en el preámbulo; \abkuerzungen imprime la lista.`,
      compact: "Lista compacta sin espaciado adicional",
      glossaryLayout: String.raw`A partir de aquí, solo formato. El archivo se carga en el preámbulo; \glossar imprime el glosario.`,
      bold: "Término en negrita, explicación justo debajo",
      addAll: "Incluir todos los términos, también los no usados; después de imprimir, si no el título se desplaza hacia abajo",
      languageNote: "",
    },
  },
  it: {
    title: "Un modello per Gilgamesh",
    author: "Nome Cognome",
    type: "Tesi di laurea",
    course: "Corso di laurea",
    department: "Dipartimento I",
    expert: "Prof. Esempio",
    locationdate: "Luogo, data",
    first: "Relatore",
    second: "Correlatore",
    bib: "Bibliografia",
    figures: "Elenco delle figure",
    tables: "Elenco delle tabelle",
    formulas: "Elenco delle equazioni",
    acronyms: "Elenco delle abbreviazioni",
    glossary: "Glossario",
    appendixName: ["appendice", "appendici"],
    refs: null,
    founded: String.raw`fond.\ 1888`,
    acronym: String.raw`\newacronym{ki}{IA}{Intelligenza artificiale}`,
    glossaryEntry: glossaryEntry(
      "Utnapishtim",
      "Sopravvissuto al diluvio nell'Epopea di Gilgamesh, a cui gli dèi donarono l'immortalità e che Gilgamesh raggiunge nella sua ricerca della vita eterna",
    ),
    abstract: abstract("Sommario", "Breve sintesi della tesi.", String.raw`\foreignlanguage{english}{A short summary of the thesis.}`),
    example: example({
      section: "Esempio",
      label: "esempio",
      intro: String.raw`Il testo inizia qui. Le abbreviazioni si scrivono con \verb|\gls| e la prima volta vengono estese: \gls{ki}.
La seconda volta compare solo l'abbreviazione: \gls{ki}.
Le fonti si citano così \cite{knuth1984}, i rimandi così: \cref{fig:esempio}, \cref{tab:esempio}.`,
      paragraph: String.raw`Un nuovo paragrafo si separa con una riga vuota e \verb|\medskip|.`,
      formulas: "Formule",
      formulasText: String.raw`Le equazioni con \verb|\formelentry| compaiono nell'elenco delle equazioni (\cref{eq:esempio}).`,
      formulaEntry: "Equivalenza massa-energia",
      figures: "Figure e tabelle",
      placeholder: "Figura",
      figureCaption: "Figura di esempio",
      tableCaption: "Tabella di esempio",
      head: "Termine & Significato",
      id: "Identificativo univoco",
    }),
    imageName: "immagine.png",
    appendix: appendix("Appendice di esempio", "appendice", "Spazio per l'appendice."),
    declaration: declaration(
      "Dichiarazione di originalità",
      `Con la presente dichiaro di aver redatto il presente lavoro in modo del tutto autonomo, senza utilizzare fonti o strumenti diversi da quelli indicati, e che il lavoro non è stato presentato, in forma uguale o simile, in nessun altro esame.
Tutte le riprese e le citazioni, letterali o parafrasate, nonché tutte le parti ideate, redatte e/o modificate con strumenti basati sull'IA, sono indicate e documentate.`,
      signatures("Luogo e data:", "Firma:"),
    ),
    confidentiality: confidentiality("Clausola di riservatezza", [
      String.raw`Il presente lavoro, intitolato \enquote{\arbeitstitel}, contiene dati riservati dell'azienda [azienda].`,
      `Non può essere reso accessibile a terzi, ad eccezione dei relatori e dei membri autorizzati della commissione d'esame,
senza l'espresso consenso dell'azienda e dell'autore.`,
      "La riproduzione o pubblicazione del lavoro, anche parziale, non è consentita senza previa autorizzazione.",
    ]),
    c: {
      tables: "Tabelle",
      accent: "Colore di accento",
      vector: "Grafica vettoriale, ad es. il logo del frontespizio",
      mono: "Identificatori tecnici in monospaziato",
      listings: "Listati di codice sorgente, ad es. per l'appendice",
      spacing: "Interlinea e spaziatura dei paragrafi, senza rientro",
      toc: "Puntini di guida nell'indice anche per le sezioni",
      formulas: String.raw`Elenco delle equazioni; voci con \formelentry{descrizione} nell'equazione`,
      titleDetails: "Dati per il frontespizio",
      header: "Intestazione nel corpo del testo: sezione corrente, numero di pagina in basso",
      cref: String.raw`Riferimenti incrociati con \cref (caricare dopo hyperref)`,
      confidential: "per tesi con dati aziendali riservati",
      logo: `Logo immaginario della "Example University" (TikZ, grafica vettoriale)`,
      logoUse: (path) => String.raw`Includere con \input{${path}}; richiede tikz con la libreria shapes.geometric.`,
      shield: "Scudo",
      star: "Stella",
      book: "Libro aperto",
      divider: "Linea divisoria",
      wordmark: "Logotipo",
      acronymHelp: String.raw`\newacronym{chiave}{forma breve}{forma estesa}; compare nell'elenco non appena si usa \gls{chiave}`,
      acronymLayout: String.raw`Da qui solo impaginazione. Il file viene caricato nel preambolo, \abkuerzungen stampa l'elenco.`,
      compact: "Elenco compatto senza spaziature aggiuntive",
      glossaryLayout: String.raw`Da qui solo impaginazione. Il file viene caricato nel preambolo, \glossar stampa il glossario.`,
      bold: "Termine in grassetto, spiegazione subito sotto",
      addAll: "Includere tutti i termini, anche quelli non usati; dopo la stampa, altrimenti il titolo scivola in basso",
      languageNote: "",
    },
  },
  pt: {
    title: "Um modelo para o Gilgamesh",
    author: "Nome Apelido",
    type: "Trabalho final de curso",
    course: "Curso",
    department: "Departamento I",
    expert: "Prof. Doutor Exemplo",
    locationdate: "Local, data",
    first: "Orientador",
    second: "Arguente",
    bib: "Referências bibliográficas",
    figures: "Lista de Figuras",
    tables: "Lista de Tabelas",
    formulas: "Lista de Equações",
    acronyms: "Lista de Abreviaturas",
    glossary: "Glossário",
    appendixName: ["anexo", "anexos"],
    refs: [
      ["Figura", "Figuras"],
      ["Tabela", "Tabelas"],
      ["Equação", "Equações"],
    ],
    founded: String.raw`fund.\ 1888`,
    acronym: String.raw`\newacronym{ki}{IA}{Inteligência artificial}`,
    glossaryEntry: glossaryEntry(
      "Utnapishtim",
      "Sobrevivente do dilúvio na Epopeia de Gilgamesh, a quem os deuses concederam a imortalidade e que Gilgamesh procura na sua demanda pela vida eterna",
    ),
    abstract: abstract("Resumo", "Breve resumo do trabalho.", String.raw`\foreignlanguage{english}{A short summary of the thesis.}`),
    example: example({
      section: "Exemplo",
      label: "exemplo",
      intro: String.raw`O texto começa aqui. As abreviaturas escrevem-se com \verb|\gls| e, na primeira vez, aparecem por extenso: \gls{ki}.
Na segunda vez aparece apenas a abreviatura: \gls{ki}.
As fontes citam-se assim \cite{knuth1984} e as referências cruzadas assim: \cref{fig:exemplo}, \cref{tab:exemplo}.`,
      paragraph: String.raw`Um novo parágrafo separa-se com uma linha em branco e \verb|\medskip|.`,
      formulas: "Fórmulas",
      formulasText: String.raw`As equações com \verb|\formelentry| aparecem na lista de equações (\cref{eq:exemplo}).`,
      formulaEntry: "Equivalência massa-energia",
      figures: "Figuras e tabelas",
      placeholder: "Figura",
      figureCaption: "Figura de exemplo",
      tableCaption: "Tabela de exemplo",
      head: "Termo & Significado",
      id: "Identificador único",
    }),
    imageName: "imagem.png",
    appendix: appendix("Anexo de exemplo", "anexo", "Espaço para o anexo."),
    declaration: declaration(
      "Declaração de autoria",
      `Declaro, por minha honra, que elaborei o presente trabalho de forma inteiramente autónoma, sem recorrer a fontes ou meios além dos nele indicados, e que o trabalho não foi apresentado, na mesma forma ou em forma semelhante, em nenhuma outra prova.
Todas as transcrições e citações, literais ou parafraseadas, bem como todas as partes concebidas, redigidas e/ou editadas com ferramentas baseadas em IA, estão assinaladas e referenciadas.`,
      signatures("Local e data:", "Assinatura:"),
    ),
    confidentiality: confidentiality("Cláusula de confidencialidade", [
      String.raw`O presente trabalho, intitulado \enquote{\arbeitstitel}, contém dados confidenciais da empresa [empresa].`,
      `Não pode ser disponibilizado a terceiros, à exceção dos avaliadores e dos membros autorizados do júri,
sem o consentimento expresso da empresa e do autor.`,
      "A reprodução ou publicação do trabalho, mesmo parcial, não é permitida sem autorização prévia.",
    ]),
    c: {
      tables: "Tabelas",
      accent: "Cor de destaque",
      vector: "Gráficos vetoriais, p. ex. o logótipo da capa",
      mono: "Identificadores técnicos em monoespaçado",
      listings: "Listagens de código-fonte, p. ex. para o anexo",
      spacing: "Espaçamento entre linhas e parágrafos, sem avanço",
      toc: "Pontos de guia no índice também para as secções",
      formulas: String.raw`Lista de equações; entradas com \formelentry{descrição} dentro da equação`,
      titleDetails: "Dados da capa",
      header: "Cabeçalho no corpo do texto: secção atual, número de página em baixo",
      cref: String.raw`Referências cruzadas com \cref (carregar depois do hyperref)`,
      confidential: "para trabalhos com dados confidenciais de empresas",
      logo: `Logótipo fictício da "Example University" (TikZ, gráfico vetorial)`,
      logoUse: (path) => String.raw`Incluir com \input{${path}}; requer tikz com a biblioteca shapes.geometric.`,
      shield: "Escudo",
      star: "Estrela",
      book: "Livro aberto",
      divider: "Linha divisória",
      wordmark: "Logótipo",
      acronymHelp: String.raw`\newacronym{chave}{forma curta}{forma longa}; aparece na lista assim que \gls{chave} for usado`,
      acronymLayout: String.raw`A partir daqui, apenas formatação. O ficheiro é carregado no preâmbulo; \abkuerzungen imprime a lista.`,
      compact: "Lista compacta sem espaçamento adicional",
      glossaryLayout: String.raw`A partir daqui, apenas formatação. O ficheiro é carregado no preâmbulo; \glossar imprime o glossário.`,
      bold: "Termo a negrito, explicação logo abaixo",
      addAll: "Incluir todos os termos, mesmo os não usados; depois da impressão, senão o título desce",
      languageNote: "",
    },
  },
  nl: {
    title: "Een sjabloon voor Gilgamesh",
    author: "Voornaam Achternaam",
    type: "Afstudeerscriptie",
    course: "Opleiding",
    department: "Faculteit I",
    expert: "Prof. dr. Voorbeeld",
    locationdate: "Plaats, datum",
    first: "Eerste beoordelaar",
    second: "Tweede beoordelaar",
    bib: "Literatuurlijst",
    figures: "Lijst van figuren",
    tables: "Lijst van tabellen",
    formulas: "Lijst van vergelijkingen",
    acronyms: "Lijst van afkortingen",
    glossary: "Woordenlijst",
    appendixName: ["bijlage", "bijlagen"],
    refs: null,
    founded: String.raw`opgr.\ 1888`,
    acronym: String.raw`\newacronym{ki}{AI}{Artificiële intelligentie}`,
    glossaryEntry: glossaryEntry(
      "Utnapisjtim",
      "Overlevende van de zondvloed in het Gilgamesj-epos, aan wie de goden onsterfelijkheid schonken en die Gilgamesj opzoekt op zijn zoektocht naar het eeuwige leven",
    ),
    abstract: abstract(
      "Samenvatting",
      "Korte samenvatting van de scriptie.",
      String.raw`\foreignlanguage{english}{A short summary of the thesis.}`,
    ),
    example: example({
      section: "Voorbeeld",
      label: "voorbeeld",
      intro: String.raw`Hier begint de tekst. Afkortingen zet je met \verb|\gls|; de eerste keer worden ze voluit geschreven: \gls{ki}.
De tweede keer verschijnt alleen de afkorting: \gls{ki}.
Bronnen citeer je zo \cite{knuth1984}, kruisverwijzingen zo: \cref{fig:voorbeeld}, \cref{tab:voorbeeld}.`,
      paragraph: String.raw`Een nieuwe alinea begint na een lege regel en \verb|\medskip|.`,
      formulas: "Formules",
      formulasText: String.raw`Vergelijkingen met \verb|\formelentry| verschijnen in de lijst van vergelijkingen (\cref{eq:voorbeeld}).`,
      formulaEntry: "Massa-energie-equivalentie",
      figures: "Figuren en tabellen",
      placeholder: "Figuur",
      figureCaption: "Voorbeeldfiguur",
      tableCaption: "Voorbeeldtabel",
      head: "Begrip & Betekenis",
      id: "Unieke identificatie",
    }),
    imageName: "afbeelding.png",
    appendix: appendix("Voorbeeldbijlage", "bijlage", "Ruimte voor de bijlage."),
    declaration: declaration(
      "Verklaring van eigen werk",
      `Hierbij verklaar ik dat ik dit werk geheel zelfstandig heb geschreven, geen andere dan de vermelde bronnen en hulpmiddelen heb gebruikt en dat het werk niet in dezelfde of een vergelijkbare vorm bij een ander examen is ingediend.
Alle letterlijke of inhoudelijke overnames en citaten, evenals alle delen die met behulp van op AI gebaseerde tools zijn ontworpen, geschreven en/of bewerkt, zijn als zodanig gemarkeerd en verantwoord.`,
      signatures("Plaats, datum:", "Handtekening:"),
    ),
    confidentiality: confidentiality("Vertrouwelijkheidsverklaring", [
      String.raw`Dit werk met de titel \enquote{\arbeitstitel} bevat vertrouwelijke gegevens van het bedrijf [bedrijf].`,
      `Het mag zonder uitdrukkelijke toestemming van het bedrijf en de auteur niet toegankelijk worden gemaakt voor derden,
met uitzondering van de beoordelaars en bevoegde leden van de examencommissie.`,
      "Vermenigvuldiging en publicatie van het werk, ook in delen, zijn zonder voorafgaande toestemming niet toegestaan.",
    ]),
    c: {
      tables: "Tabellen",
      accent: "Accentkleur",
      vector: "Vectorafbeeldingen, bijv. het logo op het titelblad",
      mono: "Technische namen in monospace",
      listings: "Broncodelistings, bijv. voor de bijlage",
      spacing: "Regel- en alinea-afstand, geen inspringing",
      toc: "Puntjes in de inhoudsopgave, ook na de secties",
      formulas: String.raw`Lijst van vergelijkingen; items met \formelentry{beschrijving} in de vergelijking`,
      titleDetails: "Gegevens voor het titelblad",
      header: "Koptekst in de hoofdtekst: huidige sectie, paginanummer onderaan",
      cref: String.raw`Kruisverwijzingen met \cref (na hyperref laden)`,
      confidential: "bij scripties met vertrouwelijke bedrijfsgegevens",
      logo: `Verzonnen logo van "Example University" (TikZ, vectorafbeelding)`,
      logoUse: (path) => String.raw`Invoegen met \input{${path}}; vereist tikz met de bibliotheek shapes.geometric.`,
      shield: "Wapenschild",
      star: "Ster",
      book: "Opengeslagen boek",
      divider: "Scheidingslijn",
      wordmark: "Woordmerk",
      acronymHelp: String.raw`\newacronym{sleutel}{korte vorm}{lange vorm}; verschijnt in de lijst zodra \gls{sleutel} wordt gebruikt`,
      acronymLayout: String.raw`Vanaf hier alleen opmaak. Het bestand wordt in de preambule geladen, \abkuerzungen drukt de lijst af.`,
      compact: "Compacte lijst zonder extra witruimte",
      glossaryLayout: String.raw`Vanaf hier alleen opmaak. Het bestand wordt in de preambule geladen, \glossar drukt de woordenlijst af.`,
      bold: "Begrip vet, uitleg er direct onder",
      addAll: "Alle begrippen opnemen, ook ongebruikte; na het afdrukken, anders zakt de kop omlaag",
      languageNote: "",
    },
  },
  pl: {
    title: "Szablon dla Gilgamesh",
    author: "Imię Nazwisko",
    type: "Praca dyplomowa",
    course: "Kierunek studiów",
    department: "Wydział I",
    expert: "prof. dr hab. Przykład",
    locationdate: "Miejscowość, data",
    first: "Promotor",
    second: "Recenzent",
    bib: "Bibliografia",
    figures: "Spis rysunków",
    tables: "Spis tabel",
    formulas: "Spis wzorów",
    acronyms: "Wykaz skrótów",
    glossary: "Słowniczek",
    appendixName: ["załącznik", "załączniki"],
    refs: [
      ["Rysunek", "Rysunki"],
      ["Tabela", "Tabele"],
      ["Równanie", "Równania"],
    ],
    founded: String.raw`zał.\ 1888`,
    acronym: String.raw`\newacronym{ki}{SI}{Sztuczna inteligencja}`,
    glossaryEntry: glossaryEntry(
      "Utnapisztim",
      "Ocalały z potopu w Eposie o Gilgameszu, któremu bogowie podarowali nieśmiertelność i którego Gilgamesz odwiedza w poszukiwaniu życia wiecznego",
    ),
    abstract: abstract(
      "Streszczenie",
      "Krótkie streszczenie pracy.",
      String.raw`\foreignlanguage{english}{A short summary of the thesis.}`,
    ),
    example: example({
      section: "Przykład",
      label: "przyklad",
      intro: String.raw`Tutaj zaczyna się tekst. Skróty zapisuje się za pomocą \verb|\gls|; za pierwszym razem są rozwijane: \gls{ki}.
Za drugim razem pojawia się już tylko skrót: \gls{ki}.
Źródła cytuje się tak \cite{knuth1984}, a odsyłacze tak: \cref{fig:przyklad}, \cref{tab:przyklad}.`,
      paragraph: String.raw`Nowy akapit oddziela się pustym wierszem i \verb|\medskip|.`,
      formulas: "Wzory",
      formulasText: String.raw`Równania z \verb|\formelentry| pojawiają się w spisie wzorów (\cref{eq:przyklad}).`,
      formulaEntry: "Równoważność masy i energii",
      figures: "Rysunki i tabele",
      placeholder: "Rysunek",
      figureCaption: "Przykładowy rysunek",
      tableCaption: "Przykładowa tabela",
      head: "Pojęcie & Znaczenie",
      id: "Unikalny identyfikator",
    }),
    imageName: "obraz.png",
    appendix: appendix("Przykładowy załącznik", "zalacznik", "Miejsce na załącznik."),
    declaration: declaration(
      "Oświadczenie autora pracy",
      `Niniejszym oświadczam, że niniejszą pracę przygotowałem/przygotowałam w całości samodzielnie, nie korzystając z innych źródeł ani pomocy niż wskazane w pracy, oraz że praca w tej samej lub podobnej formie nie była przedmiotem żadnego innego egzaminu.
Wszystkie dosłowne lub pośrednie zapożyczenia i cytaty, a także wszystkie fragmenty opracowane, napisane i/lub zredagowane przy użyciu narzędzi opartych na SI, zostały oznaczone i udokumentowane.`,
      signatures("Miejscowość, data:", "Podpis:"),
    ),
    confidentiality: confidentiality("Klauzula poufności", [
      String.raw`Niniejsza praca pt. \enquote{\arbeitstitel} zawiera poufne dane przedsiębiorstwa [przedsiębiorstwo].`,
      `Bez wyraźnej zgody przedsiębiorstwa i autora praca nie może być udostępniana osobom trzecim,
z wyjątkiem recenzentów i upoważnionych członków komisji egzaminacyjnej.`,
      "Powielanie i publikowanie pracy, również we fragmentach, bez uprzedniej zgody jest zabronione.",
    ]),
    c: {
      tables: "Tabele",
      accent: "Kolor akcentu",
      vector: "Grafika wektorowa, np. logo na stronie tytułowej",
      mono: "Nazwy techniczne czcionką o stałej szerokości",
      listings: "Listingi kodu źródłowego, np. do załącznika",
      spacing: "Odstępy między wierszami i akapitami, bez wcięć",
      toc: "Kropki w spisie treści także dla sekcji",
      formulas: String.raw`Spis wzorów; wpisy przez \formelentry{opis} w równaniu`,
      titleDetails: "Dane do strony tytułowej",
      header: "Nagłówek w części głównej: bieżąca sekcja, numer strony na dole",
      cref: String.raw`Odsyłacze przez \cref (ładować po hyperref)`,
      confidential: "w przypadku prac z poufnymi danymi firmy",
      logo: "Wymyślone logo „Example University” (TikZ, grafika wektorowa)",
      logoUse: (path) => String.raw`Wstawianie przez \input{${path}}; wymaga tikz z biblioteką shapes.geometric.`,
      shield: "Tarcza herbowa",
      star: "Gwiazda",
      book: "Otwarta książka",
      divider: "Linia podziału",
      wordmark: "Logotyp",
      acronymHelp: String.raw`\newacronym{klucz}{skrót}{pełna nazwa}; pojawia się w wykazie, gdy tylko użyto \gls{klucz}`,
      acronymLayout: String.raw`Od tego miejsca tylko wygląd. Plik jest ładowany w preambule, \abkuerzungen wypisuje wykaz.`,
      compact: "Zwarta lista bez dodatkowych odstępów",
      glossaryLayout: String.raw`Od tego miejsca tylko wygląd. Plik jest ładowany w preambule, \glossar wypisuje słowniczek.`,
      bold: "Pojęcie pogrubione, objaśnienie bezpośrednio pod nim",
      addAll: "Uwzględnij wszystkie pojęcia, także nieużyte; po wypisaniu, inaczej nagłówek przesuwa się w dół",
      languageNote: "",
    },
  },
  ru: {
    title: "Шаблон для Gilgamesh",
    author: "Имя Фамилия",
    type: "Выпускная квалификационная работа",
    course: "Направление подготовки",
    department: "Факультет I",
    expert: "проф. д-р Пример",
    locationdate: "Место, дата",
    first: "Научный руководитель",
    second: "Рецензент",
    bib: "Список литературы",
    figures: "Список иллюстраций",
    tables: "Список таблиц",
    formulas: "Список формул",
    acronyms: "Список сокращений",
    glossary: "Глоссарий",
    appendixName: ["приложение", "приложения"],
    refs: null,
    founded: String.raw`осн.\ 1888`,
    acronym: String.raw`\newacronym{ki}{ИИ}{Искусственный интеллект}`,
    glossaryEntry: glossaryEntry(
      "Утнапиштим",
      "Переживший потоп герой «Эпоса о Гильгамеше», которому боги даровали бессмертие и к которому Гильгамеш отправляется в поисках вечной жизни",
    ),
    abstract: abstract("Аннотация", "Краткое изложение работы.", String.raw`\foreignlanguage{english}{A short summary of the thesis.}`),
    example: example({
      section: "Пример",
      label: "primer",
      intro: String.raw`Здесь начинается текст. Сокращения задаются командой \verb|\gls| и при первом упоминании пишутся полностью: \gls{ki}.
При втором упоминании появляется только сокращение: \gls{ki}.
Источники цитируются так \cite{knuth1984}, перекрёстные ссылки~--- так: \cref{fig:primer}, \cref{tab:primer}.`,
      paragraph: String.raw`Новый абзац отделяется пустой строкой и \verb|\medskip|.`,
      formulas: "Формулы",
      formulasText: String.raw`Уравнения с \verb|\formelentry| попадают в список формул (\cref{eq:primer}).`,
      formulaEntry: "Эквивалентность массы и энергии",
      figures: "Рисунки и таблицы",
      placeholder: "Рисунок",
      figureCaption: "Пример рисунка",
      tableCaption: "Пример таблицы",
      head: "Термин & Значение",
      id: "Уникальный идентификатор",
    }),
    imageName: "risunok.png",
    appendix: appendix("Пример приложения", "prilozhenie", "Место для приложения."),
    declaration: declaration(
      "Заявление о самостоятельности выполнения работы",
      `Настоящим заявляю, что выполнил(а) данную работу полностью самостоятельно, не использовал(а) иных источников и вспомогательных средств, кроме указанных в работе, и что работа в той же или схожей форме не представлялась ни на каком другом экзамене.
Все дословные и смысловые заимствования и цитаты, а также все разделы, подготовленные, написанные и/или отредактированные с помощью инструментов на основе ИИ, обозначены и снабжены ссылками.`,
      signatures("Место, дата:", "Подпись:"),
    ),
    confidentiality: confidentiality("Гриф конфиденциальности", [
      String.raw`Настоящая работа на тему \enquote{\arbeitstitel} содержит конфиденциальные данные компании [компания].`,
      `Без явного согласия компании и автора работа не может быть предоставлена третьим лицам,
за исключением рецензентов и уполномоченных членов экзаменационной комиссии.`,
      "Копирование и публикация работы, в том числе частичные, без предварительного разрешения не допускаются.",
    ]),
    c: {
      tables: "Таблицы",
      accent: "Акцентный цвет",
      vector: "Векторная графика, напр. логотип на титульном листе",
      mono: "Технические обозначения моноширинным шрифтом",
      listings: "Листинги исходного кода, напр. для приложения",
      spacing: "Межстрочный интервал и отступы между абзацами, без абзацного отступа",
      toc: "Точки-заполнители в оглавлении и для разделов",
      formulas: String.raw`Список формул; записи через \formelentry{описание} внутри уравнения`,
      titleDetails: "Данные для титульного листа",
      header: "Колонтитул в основной части: текущий раздел, номер страницы внизу",
      cref: String.raw`Перекрёстные ссылки через \cref (загружать после hyperref)`,
      confidential: "для работ с конфиденциальными данными компании",
      logo: "Вымышленный логотип «Example University» (TikZ, векторная графика)",
      logoUse: (path) => String.raw`Вставляется через \input{${path}}; требует tikz с библиотекой shapes.geometric.`,
      shield: "Щит",
      star: "Звезда",
      book: "Открытая книга",
      divider: "Разделительная линия",
      wordmark: "Надпись",
      acronymHelp: String.raw`\newacronym{ключ}{сокращение}{полная форма}; попадает в список, как только используется \gls{ключ}`,
      acronymLayout: String.raw`Дальше только оформление. Файл загружается в преамбуле, \abkuerzungen выводит список.`,
      compact: "Компактный список без дополнительных отступов",
      glossaryLayout: String.raw`Дальше только оформление. Файл загружается в преамбуле, \glossar выводит глоссарий.`,
      bold: "Термин полужирным, пояснение сразу под ним",
      addAll: "Включить все термины, даже неиспользованные; после вывода, иначе заголовок смещается вниз",
      languageNote: "Кириллица: кодировка T2A, Tempora (шрифт в стиле Times) и PT Mono для моноширинного текста",
    },
  },
  zh: {
    title: "Gilgamesh 模板",
    author: "姓名",
    type: "毕业论文",
    course: "专业",
    department: "学院一",
    expert: "示例教授",
    locationdate: "地点，日期",
    first: "指导教师",
    second: "评阅人",
    bib: "参考文献",
    figures: "插图",
    tables: "表格",
    formulas: "公式目录",
    acronyms: "缩略语表",
    glossary: "术语表",
    appendixName: ["附录", "附录"],
    refs: [
      ["图", "图"],
      ["表", "表"],
      ["式", "式"],
    ],
    founded: "创建于 1888 年",
    acronym: String.raw`\newacronym{ki}{AI}{人工智能}`,
    glossaryEntry: glossaryEntry("乌特纳皮什提姆", "《吉尔伽美什史诗》中大洪水的幸存者，众神赐予他永生；吉尔伽美什为寻求永生而前去拜访他"),
    abstract: abstract("摘要", "论文的简要概述。", "A short summary of the thesis."),
    example: example({
      section: "示例",
      label: "example",
      intro: String.raw`正文从这里开始。缩写用 \verb|\gls| 输入，第一次出现时会写出全称：\gls{ki}。
第二次出现时只显示缩写：\gls{ki}。
文献这样引用 \cite{knuth1984}，交叉引用这样写：\cref{fig:example}、\cref{tab:example}。`,
      paragraph: String.raw`空一行并加上 \verb|\medskip| 即可开始新段落。`,
      formulas: "公式",
      formulasText: String.raw`带有 \verb|\formelentry| 的公式会出现在公式目录中（\cref{eq:example}）。`,
      formulaEntry: "质能等价",
      figures: "图和表",
      placeholder: "图",
      figureCaption: "示例图",
      tableCaption: "示例表",
      head: "术语 & 含义",
      id: "唯一标识符",
    }),
    imageName: "picture.png",
    appendix: appendix("示例附录", "appendix", "此处为附录内容。"),
    declaration: declaration(
      "原创性声明",
      `本人郑重声明：本论文完全由本人独立完成，除文中注明的资料和工具外，未使用任何其他来源或辅助手段；本论文未曾以相同或相似的形式提交于其他任何考试。
所有逐字或意译引用的内容，以及借助基于人工智能的工具构思、撰写和/或编辑的所有部分，均已标明并注明出处。`,
      signatures("地点、日期：", "签名："),
    ),
    confidentiality: confidentiality("保密声明", [
      String.raw`本论文题为\enquote{\arbeitstitel}，包含[公司]的机密数据。`,
      "未经公司和作者明确同意，除评阅人及考试委员会授权成员外，不得向第三方公开本论文。",
      "未经事先许可，不得复制或发表本论文的全部或部分内容。",
    ]),
    c: {
      tables: "表格",
      accent: "强调色",
      vector: "矢量图形，例如封面上的校徽",
      mono: "技术标识符使用等宽字体",
      listings: "源代码清单，例如用于附录",
      spacing: "行距和段距，不缩进",
      toc: "目录中的节标题也使用引导点",
      formulas: String.raw`公式目录；在公式中用 \formelentry{说明} 添加条目`,
      titleDetails: "封面信息",
      header: "正文页眉：当前节标题，页码在下方",
      cref: String.raw`用 \cref 进行交叉引用（在 hyperref 之后加载）`,
      confidential: "适用于包含企业机密数据的论文",
      logo: "虚构的“Example University”校徽（TikZ 矢量图形）",
      logoUse: (path) => String.raw`用 \input{${path}} 插入；需要 tikz 及 shapes.geometric 库。`,
      shield: "盾徽",
      star: "星",
      book: "打开的书",
      divider: "分隔线",
      wordmark: "文字标志",
      acronymHelp: String.raw`\newacronym{键}{缩写}{全称}；一旦使用 \gls{键}，即出现在缩略语表中`,
      acronymLayout: String.raw`以下仅为排版设置。该文件在导言区加载，\abkuerzungen 输出缩略语表。`,
      compact: "紧凑列表，无额外间距",
      glossaryLayout: String.raw`以下仅为排版设置。该文件在导言区加载，\glossar 输出术语表。`,
      bold: "术语加粗，解释紧随其下",
      addAll: "收录所有术语，包括未使用的；须放在输出之后，否则标题会下移",
      languageNote: "中文排版：ctex，使用 TeX 自带的 Fandol 字体，在所有系统上效果一致；西文使用 TeX Gyre Termes",
    },
  },
  ja: {
    title: "Gilgamesh 用テンプレート",
    author: "氏名",
    type: "卒業論文",
    course: "学科",
    department: "学部 I",
    expert: "例 教授",
    locationdate: "場所、日付",
    first: "主査",
    second: "副査",
    bib: "参考文献",
    figures: "図目次",
    tables: "表目次",
    formulas: "数式目次",
    acronyms: "略語一覧",
    glossary: "用語集",
    appendixName: ["付録", "付録"],
    refs: [
      ["図", "図"],
      ["表", "表"],
      ["式", "式"],
    ],
    founded: "1888年創立",
    acronym: String.raw`\newacronym{ki}{AI}{人工知能}`,
    glossaryEntry: glossaryEntry(
      "ウトナピシュティム",
      "『ギルガメシュ叙事詩』に登場する大洪水の生存者。神々から不死を授けられ、永遠の命を求めるギルガメシュが訪ねる人物",
    ),
    abstract: abstract("概要", "論文の簡単な要約。", "A short summary of the thesis."),
    example: example({
      section: "例",
      label: "example",
      intro: String.raw`ここから本文が始まります。略語は \verb|\gls| で入力し、初出時には正式名称が書かれます：\gls{ki}。
2回目以降は略語だけが表示されます：\gls{ki}。
文献はこのように引用し \cite{knuth1984}、相互参照はこのように書きます：\cref{fig:example}、\cref{tab:example}。`,
      paragraph: String.raw`新しい段落は空行と \verb|\medskip| で区切ります。`,
      formulas: "数式",
      formulasText: String.raw`\verb|\formelentry| を付けた数式は数式目次に載ります（\cref{eq:example}）。`,
      formulaEntry: "質量とエネルギーの等価性",
      figures: "図と表",
      placeholder: "図",
      figureCaption: "図の例",
      tableCaption: "表の例",
      head: "用語 & 意味",
      id: "一意の識別子",
    }),
    imageName: "picture.png",
    appendix: appendix("付録の例", "appendix", "ここに付録を記載します。"),
    declaration: declaration(
      "宣誓書",
      `私は、本論文をすべて自らの力で作成し、本文中に記載したもの以外の資料や補助手段を用いていないこと、また本論文を同一または類似の形で他の審査に提出していないことを、ここに宣誓します。
逐語的または趣旨的な引用・借用、ならびに AI ベースのツールを用いて構想、執筆および/または編集したすべての箇所は、その旨を明記し出典を示しています。`,
      signatures("場所・日付：", "署名："),
    ),
    confidentiality: confidentiality("機密保持に関する注意", [
      String.raw`本論文「\arbeitstitel」には、[企業名]の機密データが含まれています。`,
      "企業および著者の明示的な同意なしに、審査員および審査委員会の権限ある委員を除く第三者に本論文を開示することはできません。",
      "事前の許可なく、本論文の全部または一部を複製・公開することは禁じられています。",
    ]),
    c: {
      tables: "表",
      accent: "アクセントカラー",
      vector: "ベクター画像（例：表紙のロゴ）",
      mono: "技術的な識別子は等幅フォントで",
      listings: "ソースコードのリスト（例：付録用）",
      spacing: "行間と段落間隔、字下げなし",
      toc: "目次の節にもリーダー点を付ける",
      formulas: String.raw`数式目次。数式内で \formelentry{説明} を使って項目を追加`,
      titleDetails: "表紙の情報",
      header: "本文のヘッダー：現在の節、ページ番号は下",
      cref: String.raw`\cref による相互参照（hyperref の後に読み込む）`,
      confidential: "企業の機密データを含む論文の場合",
      logo: "架空の「Example University」のロゴ（TikZ、ベクター画像）",
      logoUse: (path) => String.raw`\input{${path}} で読み込みます。tikz と shapes.geometric ライブラリが必要です。`,
      shield: "盾",
      star: "星",
      book: "開いた本",
      divider: "区切り線",
      wordmark: "ロゴタイプ",
      acronymHelp: String.raw`\newacronym{キー}{略語}{正式名称}。\gls{キー} を使うと一覧に載ります`,
      acronymLayout: String.raw`ここから下は体裁のみ。このファイルはプリアンブルで読み込まれ、\abkuerzungen が一覧を出力します。`,
      compact: "余分な間隔のないコンパクトな一覧",
      glossaryLayout: String.raw`ここから下は体裁のみ。このファイルはプリアンブルで読み込まれ、\glossar が用語集を出力します。`,
      bold: "用語は太字、説明はそのすぐ下",
      addAll: "未使用のものも含めすべての用語を載せる。出力の後に置かないと見出しが下にずれる",
      languageNote: "日本語組版：LuaTeX-ja（TeX 付属の原ノ味フォント）、欧文は TeX Gyre Termes、見出しの名前も日本語に",
    },
  },
};
