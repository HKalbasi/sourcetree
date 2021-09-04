# Sourcetree

Sourcetree builds a static site from your source code, which has goto definition, hover, etc. So
you can view source code inside your browser, like a full featured ide. You can see
[dogfooding demo](https://hkalbasi.github.io/sourcetree/index.ts.html) here which contains source code of
this repository.

## How to use

1. Generate a [LSIF dump](https://lsif.dev/) from your repository.
2. Install a fairly new nodejs (the one on OS repository is usually old)
3. `npm install -g sourcetree-cli`
4. `sourcetree dump.lsif -o out`
5. Your static site is ready in out directory. You can serve it via `http-server` or `python3 -m http.server`.

## Features
* current:
  * File tree of the source code (so Sourcetree is the name)
  * Hover
  * Go to definition
  * Find all references of a token
* planned:
  * All other things that [LSIF supports](https://microsoft.github.io/language-server-protocol/specifications/lsif/0.5.0/specification/)

## Relation with Sourcegraph
Sourcegraph is a wonderful tool, which Sourcetree is inspired by, but it isn't a one-size-fit-all solution. Sourcegraph
targets "monorepo with loads of code", so they have a dedicated backend with databases and complex setup. So with Sourcegraph
you should go either with sourcegraph.com which is a third-party service, or host a sourcegraph instance yourself which
needs infrastructure.

On the other hand, Sourcetree enables a subset of Sourcegraph features with a bunch of static html files, which you can
build it in CI and serve it via github pages or similars. So you can use it offline with local builds, include it inside your
project website, manipulating html files in the desired way, ...

Sourcetree is something between Sourcegraph and nothing. Trees are graphs with no cycles, so they are a simple kind of
graphs, and Sourcetree is a simple kind of Sourcegraph.

Features of Sourcegraph that Sourcetree will never get:
* Anything between repositiories and global, like searching something in all codes in world
* Anything about version control. Sourcetree take a tree of source code as input, and it
doesn't even assume that there is a VCS. So it can't show info about history and other branches. You can use them together
otherway, for example building a Sourcetree for every PR
* Complex searchs, like search by regex (basic searching and indexing is possible even with static site)

