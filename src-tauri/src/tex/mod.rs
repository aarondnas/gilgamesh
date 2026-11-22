//! TeX: the distribution the app manages (TinyTeX) and its packages and
//! fonts, building with latexmk, and what is read from a build (its log,
//! SyncTeX, the table of contents, the word count).

pub mod compile;
pub mod contents;
pub mod distribution;
pub mod eps;
pub mod fonts;
mod images;
pub mod index;
pub mod log;
pub mod packages;
mod process;
pub mod synctex;
pub mod system_fonts;
pub mod wordcount;
