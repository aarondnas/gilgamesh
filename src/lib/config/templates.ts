// Starting points for new projects. Texts follow the UI language (see
// template-texts.ts); the documents themselves set babel, ctex or LuaTeX-ja
// accordingly, so hyphenation, spell checking and fonts match.
import type { Engine } from "$lib/api";
import { ARTICLE, LETTER, PRESENTATION, THESIS, type Lang } from "./template-texts";

export type TemplateId = "article" | "thesis" | "presentation" | "letter";

export interface Template {
  id: TemplateId;
  main: string;
  engine: Engine;
  /** E.g. "A-2b": theses usually have to be submitted as PDF/A. */
  pdfStandard: string | null;
  /** Project-relative path → content. Folders are created as needed. */
  files: Record<string, string>;
}

const LANGS: readonly Lang[] = ["de", "en", "fr", "es", "it", "pt", "nl", "pl", "ru", "zh", "ja"];

/** babel's name for each language. Chinese and Japanese are set with ctex and LuaTeX-ja instead. */
const BABEL: Record<Lang, string | null> = {
  de: "ngerman",
  en: "english",
  fr: "french",
  es: "spanish",
  it: "italian",
  pt: "portuguese",
  nl: "dutch",
  pl: "polish",
  ru: "russian",
  zh: null,
  ja: null,
};

/** Languages cleveref has names for; the others set theirs in the thesis texts. */
const CLEVEREF: ReadonlySet<Lang> = new Set(["de", "en", "fr", "es", "it", "nl", "ru"]);

/** TeX Gyre Termes, the Times-like Latin font next to Chinese and Japanese. */
const TERMES = String.raw`\setmainfont{texgyretermes}[Extension=.otf, UprightFont=*-regular, BoldFont=*-bold, ItalicFont=*-italic, BoldItalicFont=*-bolditalic]`;

/** Language setup for templates compiled with LuaLaTeX. Latin Modern, the default font, has
 *  no Cyrillic, so Russian takes Computer Modern Unicode, which looks the same. Fonts are
 *  named by file, so a missing one is reported and installed like any other package file.
 *  `plain`: Chinese fonts and line breaking only, without ctex's names for headings and
 *  lists, which a letter class does not have. */
function lualatexLanguage(lang: Lang, plain = false): string {
  switch (lang) {
    case "zh":
      return plain
        ? String.raw`% 信件类没有参考文献，但 ctex 仍会查找其名称
\providecommand{\refname}{参考文献}
\usepackage[fontset=fandol,scheme=plain]{ctex}`
        : String.raw`\usepackage[fontset=fandol]{ctex}`;
    case "ja":
      return String.raw`\usepackage{luatexja}`;
    case "ru":
      return String.raw`\usepackage[russian]{babel}
\babelfont{rm}[Extension=.otf, UprightFont=*rm, BoldFont=*bx, ItalicFont=*ti, BoldItalicFont=*bi]{cmun}
\babelfont{sf}[Extension=.otf, UprightFont=*ss, BoldFont=*sx, ItalicFont=*si, BoldItalicFont=*so]{cmun}
\babelfont{tt}[Extension=.otf, UprightFont=*tt, BoldFont=*tb, ItalicFont=*it, BoldItalicFont=*tx]{cmun}`;
    default:
      return String.raw`\usepackage[${BABEL[lang]}]{babel}`;
  }
}

function article(lang: Lang): Template {
  const t = ARTICLE[lang];
  return {
    id: "article",
    main: "main.tex",
    engine: "lualatex",
    pdfStandard: null,
    files: {
      "main.tex": String.raw`\documentclass{article}
${lualatexLanguage(lang)}
\usepackage{amsmath}

\title{${t.title}}
\author{}

\begin{document}
\maketitle

\section{${t.intro}}
${t.body}

\begin{equation}
  E = mc^2
\end{equation}

\end{document}
`,
    },
  };
}

/** Language and fonts of the thesis. pdfLaTeX with a Times-like font where it can set the
 *  script (Latin, and Cyrillic with Tempora); LuaLaTeX for Chinese and Japanese. */
function thesisLanguage(lang: Lang): string {
  const note = THESIS[lang].c.languageNote;
  switch (lang) {
    case "en":
      return String.raw`\usepackage[english]{babel}
\usepackage[T1]{fontenc}
\usepackage{newtxtext,newtxmath}`;
    case "fr":
      return String.raw`\usepackage[english,french]{babel}
% ${note}
\AtBeginDocument{\shorthandoff{:}}
\usepackage{caption}
\captionsetup{labelsep=endash}
\usepackage[T1]{fontenc}
\usepackage{newtxtext,newtxmath}`;
    case "ru":
      return String.raw`% ${note}
\usepackage[T2A,T1]{fontenc}
\usepackage[english,russian]{babel}
\usepackage{tempora}
\usepackage{PTMono}
\usepackage{newtxmath}`;
    case "zh":
      return String.raw`% ${note}
\usepackage[fontset=fandol]{ctex}
\usepackage{newtxmath}
${TERMES}`;
    case "ja":
      return String.raw`% ${note}
\usepackage{luatexja-fontspec}
\usepackage{newtxmath}
${TERMES}
\renewcommand{\contentsname}{目次}
\renewcommand{\listfigurename}{図目次}
\renewcommand{\listtablename}{表目次}
\renewcommand{\figurename}{図}
\renewcommand{\tablename}{表}`;
    default:
      return String.raw`\usepackage[english,${BABEL[lang]}]{babel}
\usepackage[T1]{fontenc}
\usepackage{newtxtext,newtxmath}`;
  }
}

/** Layout of a German university thesis: title page with a made-up example logo, roman front matter
 *  with all directories, section name in the header, numeric citations, appendix and declaration
 *  of authorship. The German variant is the reference; the other languages mirror it. */
function thesis(lang: Lang): Template {
  const de = lang === "de";
  const cjk = lang === "zh" || lang === "ja";
  const t = THESIS[lang];
  const c = t.c;
  const babel = BABEL[lang];
  // Paths stay ASCII in every language: not every TeX tool handles others in file names.
  const p = de
    ? {
        sections: "abschnitte",
        extra: "zusatz",
        images: "bilder",
        example: "beispiel",
        abstract: "kurzfassung",
        titlepage: "deckblatt",
        confidential: "sperrvermerk",
        acronyms: "abkuerzungen",
        glossary: "glossar",
        appendix: "anhang",
        declaration: "eidesstattliche_erklaerung",
        bib: "literatur",
      }
    : {
        sections: "sections",
        extra: "extra",
        images: "images",
        example: "example",
        abstract: "abstract",
        titlepage: "titlepage",
        confidential: "confidentiality",
        acronyms: "abbreviations",
        glossary: "glossary",
        appendix: "appendix",
        declaration: "declaration",
        bib: "references",
      };
  const directory = (title: string, command: string) => String.raw`    \phantomsection
    \addcontentsline{toc}{section}{${title}}
    ${command}
    \clearpage
`;
  // biblatex writes "u. a." in German; "et al." is what German theses usually use.
  const bibStrings =
    lang === "de" || lang === "en"
      ? String.raw`
\DefineBibliographyStrings{${babel}}{
  andothers = {et\addabbrvspace al\adddot},
}`
      : "";
  // French sets a space before the colon (its colon is an ordinary character here, see thesisLanguage);
  // Chinese and Japanese use the full-width one.
  const colon = lang === "fr" ? "~: " : cjk ? "：" : ": ";
  const refNames = t.refs
    ? ["figure", "table", "equation"]
        .map(
          (counter, i) => String.raw`
\crefname{${counter}}{${t.refs![i][0]}}{${t.refs![i][1]}}
\Crefname{${counter}}{${t.refs![i][0]}}{${t.refs![i][1]}}`,
        )
        .join("")
    : "";
  return {
    id: "thesis",
    main: "main.tex",
    engine: cjk ? "lualatex" : "pdflatex",
    pdfStandard: "A-2b",
    files: {
      "main.tex": String.raw`\documentclass[12pt]{article}
${thesisLanguage(lang)}
\usepackage{bm}
\usepackage{graphicx}
\usepackage[hidelinks,bookmarksnumbered=true]{hyperref}
\usepackage[acronym${lang === "ru" ? ",nolangwarn" : ""}]{glossaries}

\makenoidxglossaries
\input{${p.extra}/${p.acronyms}}
\input{${p.extra}/${p.glossary}}

% ${c.tables}
\usepackage{booktabs}
\usepackage{tabularx}
\usepackage{xltabular}
\usepackage{float}
\renewcommand{\arraystretch}{1.2}

\usepackage[backend=biber, style=numeric, sorting=none]{biblatex}
\addbibresource{${p.extra}/${p.bib}.bib}${bibStrings}
\usepackage{csquotes}
\DeclareNameAlias{author}{family-given}
\DeclareFieldFormat{labelnumberwidth}{\mkbibbrackets{#1}}

\usepackage{pdfpages}

% ${c.accent}
\usepackage{xcolor}
\definecolor{akzent}{HTML}{000000}

% ${c.vector}
\usepackage{tikz}
\usetikzlibrary{shapes.geometric}

% ${c.mono}
\newcommand{\code}[1]{\texttt{#1}}

% ${c.listings}
\usepackage{listings}
\lstdefinestyle{code}{
  basicstyle=\ttfamily\footnotesize,
  keywordstyle=\color{akzent}\bfseries,
  commentstyle=\color{black!55}\itshape,
  stringstyle=\color{black!75},
  numbers=left,
  numberstyle=\tiny\color{black!50},
  numbersep=8pt,
  showstringspaces=false,
  breaklines=true,
  frame=single,
  tabsize=4,
  literate=%
    {ä}{{\"a}}1 {ö}{{\"o}}1 {ü}{{\"u}}1
    {Ä}{{\"A}}1 {Ö}{{\"O}}1 {Ü}{{\"U}}1
    {ß}{{\ss}}1
}

% ${c.spacing}
\usepackage{setspace}
\setstretch{1.2}
\setlength{\medskipamount}{9pt plus 3pt minus 3pt}
\setlength{\parindent}{0pt}

\setcounter{secnumdepth}{3}
\setcounter{tocdepth}{2}

\usepackage[a4paper, margin=2.5cm]{geometry}

% ${c.toc}
\usepackage{tocloft}
\renewcommand{\cftsecleader}{\cftdotfill{\cftdotsep}}

% ${c.formulas}
\newlistof{formel}{loe}{${t.formulas}}
\renewcommand{\cftloetitlefont}{\cftloftitlefont}
\setlength{\cftbeforeloetitleskip}{\cftbeforeloftitleskip}
\setlength{\cftafterloetitleskip}{\cftafterloftitleskip}
\newcommand{\formelentry}[1]{%
  \addcontentsline{loe}{formel}{\protect\numberline{\theequation}#1}%
}

% #####################################
% ${c.titleDetails}
% #####################################
\title{${t.title}}
\author{${t.author}}
\def\thesistype{${t.type}}
\def\course{${t.course}}
\def\subjectdepartment{${t.department}}
\def\primaryexpert{${t.expert}}
\def\secondaryexpert{${t.expert}}
\makeatletter
\newcommand{\locationdate}[1]{\def\@locationdate{#1}}
\newcommand{\arbeitstitel}{\@title}
\makeatother
\locationdate{${t.locationdate}}

% #####################################
% ${c.header}
% #####################################
\usepackage{fancyhdr}
\setlength{\headheight}{15pt}
\fancyhf{}
\renewcommand{\sectionmark}[1]{\markboth{#1}{}}
\fancyhead[C]{\small\leftmark}
\fancyfoot[C]{\small\thepage}
\renewcommand{\headrulewidth}{0pt}

% ${c.cref}
\usepackage[${CLEVEREF.has(lang) ? `${babel},noabbrev,` : ""}nameinlink]{cleveref}${refNames}

\begin{document}

    \pagenumbering{gobble}
    \input{${p.extra}/${p.titlepage}}
    \clearpage

    \pagenumbering{roman}
    % \input{${p.extra}/${p.confidential}}\clearpage % ${c.confidential}

    \input{${p.sections}/${p.abstract}}
    \clearpage

    \tableofcontents
    \clearpage

${directory(t.figures, "\\listoffigures")}
${directory(t.tables, "\\listoftables")}
${directory(t.formulas, "\\listofformel")}
${directory(t.acronyms, "\\abkuerzungen")}
${directory(t.glossary, "\\glossar")}
    \pagenumbering{arabic}
    \pagestyle{fancy}

    \include{${p.sections}/${p.example}}

    \clearpage
    \pagestyle{plain}
    \printbibliography[heading=bibintoc, title={${t.bib}}]

    \clearpage
    \appendix
    \crefname{section}{${t.appendixName[0]}}{${t.appendixName[1]}}
    \Crefname{section}{${t.appendixName[0]}}{${t.appendixName[1]}}
    \input{${p.extra}/${p.appendix}}

    \clearpage
    \input{${p.extra}/${p.declaration}}

\end{document}
`,
      [`${p.extra}/${p.titlepage}.tex`]: String.raw`\thispagestyle{empty}

\makeatletter
\begin{center}

    \input{${p.images}/logo}

    \vspace{20pt}

    \noindent\rule{\textwidth}{0.4pt}
    \vspace{10pt}

    {\LARGE \textbf{\thesistype}}

    \vspace{10pt}

    {\Large \textcolor{akzent}{\@title}\\}

    \vspace{20pt}

    \noindent\rule{\textwidth}{0.4pt}

    \vspace{50pt}

    {\large \course}

    \vspace{5pt}

    {\large \subjectdepartment}

    \vspace{20pt}

    {\large \@author}

    \vspace{60pt}

    {\footnotesize \@locationdate}

    \vfill

    {\large ${t.first}${colon}\primaryexpert}

    \vspace{5pt}

    {\large ${t.second}${colon}\secondaryexpert}
\end{center}
\makeatother
`,
      [`${p.images}/logo.tex`]: String.raw`% ${c.logo}
% ${c.logoUse(`${p.images}/logo`)}
\definecolor{euNavy}{HTML}{1B2A4A}
\definecolor{euGold}{HTML}{C9A227}
\begin{tikzpicture}[line join=round]
  % ${c.shield}
  \fill[euNavy] (-1,1.2) -- (1,1.2) -- (1,0.1)
    .. controls (1,-0.7) and (0.4,-1.05) .. (0,-1.35)
    .. controls (-0.4,-1.05) and (-1,-0.7) .. (-1,0.1) -- cycle;
  \draw[euGold, line width=0.9pt] (-0.86,1.06) -- (0.86,1.06) -- (0.86,0.1)
    .. controls (0.86,-0.6) and (0.34,-0.92) .. (0,-1.18)
    .. controls (-0.34,-0.92) and (-0.86,-0.6) .. (-0.86,0.1) -- cycle;

  % ${c.star}
  \node[star, star points=5, star point ratio=2.3, fill=euGold, inner sep=0pt,
        minimum size=0.42cm] at (0,0.68) {};

  % ${c.book}
  \fill[white] (0,-0.62) .. controls (-0.28,-0.46) and (-0.48,-0.46) .. (-0.68,-0.52)
    -- (-0.68,0.14) .. controls (-0.48,0.2) and (-0.28,0.2) .. (0,0.04) -- cycle;
  \fill[white] (0,-0.62) .. controls (0.28,-0.46) and (0.48,-0.46) .. (0.68,-0.52)
    -- (0.68,0.14) .. controls (0.48,0.2) and (0.28,0.2) .. (0,0.04) -- cycle;
  \draw[euGold, line width=0.8pt] (0,0.04) -- (0,-0.62);
  \foreach \y in {0,-0.13,-0.26,-0.39} {
    \draw[euNavy!45, line width=0.5pt]
      (-0.58,\y) .. controls (-0.42,\y+0.04) and (-0.24,\y+0.03) .. (-0.08,\y-0.05);
    \draw[euNavy!45, line width=0.5pt]
      (0.58,\y) .. controls (0.42,\y+0.04) and (0.24,\y+0.03) .. (0.08,\y-0.05);
  }

  % ${c.divider}
  \draw[euGold, line width=1.2pt] (1.35,1.1) -- (1.35,-1.2);

  % ${c.wordmark}
  \node[anchor=base west, inner sep=0pt, text=euNavy] at (1.65,0.35)
    {\fontsize{30}{32}\selectfont\bfseries EXAMPLE};
  \node[anchor=base west, inner sep=0pt, text=euNavy] at (1.68,-0.38)
    {\fontsize{17}{19}\selectfont U\kern2.6pt N\kern2.6pt I\kern2.6pt V\kern2.6pt E\kern2.6pt R\kern2.6pt S\kern2.6pt I\kern2.6pt T\kern2.6pt Y};
  \node[anchor=base west, inner sep=0pt, text=euGold!85!black] at (1.68,-1.05)
    {\fontsize{10}{12}\selectfont\itshape Sapientia per Exempla \textperiodcentered{} ${t.founded}};
\end{tikzpicture}
`,
      [`${p.extra}/${p.confidential}.tex`]: t.confidentiality,
      [`${p.sections}/${p.abstract}.tex`]: t.abstract,
      [`${p.sections}/${p.example}.tex`]: t.example(`${p.images}/${t.imageName}`),
      [`${p.extra}/${p.acronyms}.tex`]: String.raw`% ${c.acronymHelp}
${t.acronym}

% ${c.acronymLayout}
% ${c.compact}
\newglossarystyle{acronymspaced}{%
  \setglossarystyle{list}%
  \renewenvironment{theglossary}%
    {\begin{description}%
       \setlength{\itemsep}{0pt}%
       \setlength{\parsep}{0pt}%
       \setlength{\topsep}{0pt}}%
    {\end{description}}%
}

\newcommand{\abkuerzungen}{%
  \begingroup
  \setstretch{1.0}%
  \printnoidxglossary[type=\acronymtype, style=acronymspaced, title=${t.acronyms}, nonumberlist]%
  \endgroup
}
`,
      [`${p.extra}/${p.glossary}.tex`]: String.raw`${t.glossaryEntry}

% ${c.glossaryLayout}
% ${c.bold}
\newglossarystyle{begriffe}{%
  \renewenvironment{theglossary}{}{}%
  \renewcommand*{\glossaryheader}{}%
  \renewcommand*{\glsgroupheading}[1]{}%
  \renewcommand*{\glsgroupskip}{}%
  \renewcommand*{\glossentry}[2]{%
    \textbf{\glossentryname{##1}}\par\nobreak
    \glossentrydesc{##1}\glspostdescription\par\medskip}%
  \renewcommand*{\subglossentry}[3]{\glossentry{##2}{##3}}%
}

\newcommand{\glossar}{%
  \begingroup
  \setstretch{1.0}%
  \printnoidxglossary[style=begriffe, title=${t.glossary}]%
  % ${c.addAll}
  \glsaddall
  \endgroup
}
`,
      [`${p.extra}/${p.appendix}.tex`]: t.appendix,
      [`${p.extra}/${p.declaration}.tex`]: t.declaration,
      [`${p.extra}/${p.bib}.bib`]: `@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984},
}
`,
    },
  };
}

function presentation(lang: Lang): Template {
  const t = PRESENTATION[lang];
  return {
    id: "presentation",
    main: "main.tex",
    engine: "lualatex",
    pdfStandard: null,
    files: {
      "main.tex": String.raw`\documentclass{beamer}
${lualatexLanguage(lang)}
\usetheme{Madrid}

\title{${t.title}}
\author{}
\date{\today}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{${t.first}}
  \begin{itemize}
    \item ${t.points[0]}
    \item ${t.points[1]}
  \end{itemize}
\end{frame}

\end{document}
`,
    },
  };
}

function letter(lang: Lang): Template {
  const t = LETTER[lang];
  return {
    id: "letter",
    main: "main.tex",
    engine: "lualatex",
    pdfStandard: null,
    files: {
      "main.tex": String.raw`\documentclass${t.classOptions ? `[${t.classOptions}]` : ""}{scrlttr2}
\LoadLetterOption{${t.layout}}
% The sender at the top right; after the letter option, so that cannot move it.
\KOMAoptions{fromalign=right}
${lualatexLanguage(lang, true)}

\setkomavar{fromname}{${t.fromName}}
\setkomavar{fromaddress}{${t.fromAddress}}
\setkomavar{subject}{${t.subject}}

\begin{document}
\begin{letter}{${t.to}}
\opening{${t.opening}}

${t.body}

\closing{${t.closing}}
\end{letter}
\end{document}
`,
    },
  };
}

export const TEMPLATE_IDS: TemplateId[] = ["article", "thesis", "presentation", "letter"];

/** The template in the UI language; English for any other. */
export function template(id: TemplateId, uiLocale: string): Template {
  const lang = LANGS.find((l) => l === uiLocale) ?? "en";
  return { article, thesis, presentation, letter }[id](lang);
}
