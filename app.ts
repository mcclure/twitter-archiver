import AdmZip from 'adm-zip';
import {promisify} from 'node:util';
import {basename as pathBasename, dirname as pathDirname, isAbsolute as pathIsAbsolute, join as pathJoin} from 'node:path';
import {readdirSync as fsReaddirSync} from 'node:fs'
import fsExtra from 'fs-extra';
import assert from 'node:assert';

const [fsWriteFile, fsMkdir] = [fsExtra.writeFile, fsExtra.mkdir];

// Note: Tweets rendered in 3 places; look for 🔗

// @ts-ignore
const webEnvironment = typeof document !== "undefined"
let directoriesDisabled = webEnvironment && document.getElementById('disable-directories').checked;
console.log('loaded...');

type Known<T> = any extends T ? never : T; // h/t Aleksei
function known<T> (t: Known<T>): Known<T> { return t;}

// Remove the next three lines if you're gonna restore web support I guess
assert(!webEnvironment, "Browser support currently believed to be broken.")
declare var document: any;
declare var window: any;

let baseUrlOverride:string|null = null;
let tweets:any[]|null = null;

function makeOpenGraph(tweet, accountInfo) {
  // trim trailing slash if included by user
  const baseUrl = baseUrlOverride != null ? baseUrlOverride : document.getElementById('baseUrl').value.replace(/\/$/,'');
  let mediaUrl = '';
  let firstMedia = null;
  if (tweet.extended_entities && tweet.extended_entities.media && tweet.extended_entities.media.length > 0) {
    firstMedia = tweet.extended_entities.media[0];
    if (firstMedia.type === 'photo') {
      const fileNameMatch = firstMedia.media_url.match(/(?:.+\/)(.+)/);
      mediaUrl = `${baseUrl}/${accountInfo.userName}/tweets_media/${tweet.id_str || tweet.id}-${fileNameMatch ? fileNameMatch[1] : ''}`;
    }
    if (firstMedia.type === 'video') {
      const variantVideos = firstMedia.video_info.variants.filter(item => item.content_type === 'video/mp4');
      const video = variantVideos
        .filter(item => item.bitrate)
        .reduce((prev, current) => (+prev.bitrate > +current.bitrate) ? prev : current);
      const fileNameMatch = video.url.match(/(?:.+\/)(.+)\?/);
      mediaUrl = `${baseUrl}/${accountInfo.userName}/tweets_media/${tweet.id_str || tweet.id}-${fileNameMatch ? fileNameMatch[1] : ''}`;
    }
  }
  return `
  <meta property="og:url" content="${baseUrl}/${accountInfo.userName}/status/${tweet.id_str || tweet.id}" />
  <meta property="og:title" content="${accountInfo.displayName} on Twitter (archived)" />
  <meta property="og:description" content="${tweet.title.replace(/"/g,"'")}" />
  ${firstMedia && firstMedia.type === 'photo' ? `<meta property="og:image" content="${mediaUrl}" />` : ''}
  ${firstMedia && firstMedia.type === 'video' ? `<meta property="og:video" content="${mediaUrl}" />` : ''}
`;
}

function formatTweet(tweet) {
  tweet.title = tweet.full_text;
  if (tweet.entities.urls && tweet.entities.urls.length > 0) {
    for (let url of tweet.entities.urls) {
      tweet.full_text = tweet.full_text.replace(url.url, `<a href="${url.expanded_url}">${url.expanded_url}</a>`);
    }
    tweet.title = tweet.full_text;
  }
  if (tweet.extended_entities && tweet.extended_entities.media && tweet.extended_entities.media.length > 0) {
    let medias = [];
    for (let media of tweet.extended_entities.media) {
      if (media.type === 'photo') {
        const fileNameMatch = media.media_url.match(/(?:.+\/)(.+)/);
        const newUrl = `${directoriesDisabled ? '../' : ''}../../tweets_media/${tweet.id_str || tweet.id}-${fileNameMatch ? fileNameMatch[1] : ''}`;
        medias.push(`<li><a target="_blank" href="${newUrl}"><img src="${newUrl}"></a></li>`);
      }
      if (media.type === 'video') {
        const variantVideos = media.video_info.variants.filter(item => item.content_type === 'video/mp4');
        const video = variantVideos
          .filter(item => item.bitrate)
          .reduce((prev, current) => (+prev.bitrate > +current.bitrate) ? prev : current);
        const fileNameMatch = video.url.match(/(?:.+\/)(.+)\??/);
        const newUrl = `${directoriesDisabled ? '../' : ''}../../tweets_media/${tweet.id_str || tweet.id}-${fileNameMatch ? fileNameMatch[1] : ''}`;
        medias.push(`<li><video controls src="${newUrl}"></video></li>`);
      }
    }
    tweet.full_text = tweet.full_text.replace(tweet.extended_entities.media[0].url, `<div class="gallery"><ul>${medias.join('')}</ul></div>`);
    // put a placeholder title if it's a media-only tweet with no text
    if (tweet.extended_entities.media[0].indices[0] === '0') {
      tweet.title = '(media tweet)';
    } else {
      tweet.title = tweet.full_text.replace(/<[^>]+>/g, '');
    }
  }
  tweet.full_text = tweet.full_text.replace(/(?:\r\n|\r|\n)/g, '<br>');
  return tweet;
}

// threadStatus can be one of: 'parent', 'child', 'main'
function makeTweet(tweet, accountInfo, threadStatus) {
  const articles = [];
  // first check if there is a parent and render that, but not if we are traversing the children tree
  if (threadStatus !== 'child' && tweet.in_reply_to_status_id_str && tweet.in_reply_to_user_id_str === accountInfo.accountId.toString()) {
    let parentTweet = tweets.find(item => item.id_str === tweet.in_reply_to_status_id_str);
    if (parentTweet) {
      parentTweet = formatTweet(parentTweet);
      articles.push(makeTweet(parentTweet, accountInfo, 'parent'));
    }
  }
  // now render this main tweet
  const article = `
  	  <article class="tweet ${threadStatus === 'parent' ? 'parent' : ''} ${threadStatus === 'child' ? 'child' : ''}" ${threadStatus === 'main' ? 'id="main"' : ''}>
  	    <div class="flex-cols">
          <a href="../../.."><img class="article_avatar" src="../../../${accountInfo.avatarPath}" /></a>
          <div>
            <p class="display_name">
      	      ${accountInfo.displayName}
      	    </p>
            <p class="user_name">
              <a href="../..">@${accountInfo.userName}</a>
            </p>
          </div>
        </div>
  	    <p class="full_text">
  	      ${tweet.full_text}
  	    </p>
  	    <p class="created_at">
  	      ${new Date(tweet.created_at).toLocaleString()}
          <a class="permalink" href="../${tweet.id_str}">🔗</a>
  	    </p>
  	    <p class="favorite_count">Favs: ${tweet.favorite_count}</p>
  	    <p class="retweet_count">Retweets: ${tweet.retweet_count}</p>
  	  </article>
`;
  articles.push(article);
  // now check if there are children and render those, but only if we are not traversing the parent tree!
  if (threadStatus !== 'parent' && tweet.children && tweet.children.length > 0) {
    for (let child of tweet.children) {
      let childTweet = tweets.find(item => item.id_str === child);
      if (childTweet) {
        childTweet = formatTweet(childTweet);
        articles.push(makeTweet(childTweet, accountInfo, 'child'));
      }
    }
  }
  return articles.join('\n');
}

function makePage(tweet, accountInfo) {
  tweet = formatTweet(tweet);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${makeOpenGraph(tweet, accountInfo)}
  <title>${tweet.title}</title>
  <link rel="stylesheet" href="../../../styles.css">
</head>
<body>
  <div class="wrapper">
  	<div class="flex-wrap">
      <a href="../../../">
        <p>&larr; @${accountInfo.userName} Twitter archive</p>
      </a>
      ${makeTweet(tweet, accountInfo, 'main')}
  	</div>
  </div>
</body>
<script>
document.getElementById('main').scrollIntoView();
</script>
</html>`;
  return html;
}

function makeStyles() {
  return `
body {
  font-family: sans-serif;
  font-size: 1.2em;
}
#search-input {
  font-size: 1.5em;
  width: 100%;
}
.search_time {
  display: inline;
  font-size:0.75em;
}
.search_text {
  display: block;
  margin-bottom: 4px;
}
.search_link {
  display: inline;
}
#sorting {
  margin-top: 8px;
  line-height: 1.7em;
}
.sort-button {
  font-size: 1.0em;
}
.wrapper {
  display: block;
  max-width: 600px;
  margin: 0 auto;
  word-wrap: break-word;
}
.flex-wrap {
  display: flex;
  flex-direction: column;
}
.flex-cols {
  display: flex;
  flex-direction: row;
}
.tweet img.article_avatar {
  width:64px;
  margin-right:1em;
}
.reply_badge {
  display: inline;
  margin-left: 6px;
  font-size:0.6em;
}
.tweet {
    background-color: #e8e8e8;
    max-width: 600px;
    padding: 16px;
    font-family: sans-serif;
    font-size: 1.2em;
    border: 2px solid black;
    border-radius: 16px;
}
.tweet img {
  max-height: 100%;
  vertical-align: bottom;
  width: 100%;
  object-fit: cover;
}
.tweet video {
  max-height: 100%;
  vertical-align: bottom;
  width: 100%;
}
.tweet ul {
  display: flex;
  flex-wrap: wrap;
  list-style-type: none;
  gap: 8px;
  padding-left: 0px;
  margin-bottom: 0px;
}
.tweet li {
  width: 20vh;
  flex-grow: 1;
}
.tweet .display_name {
  margin-bottom: 0;
  margin-top: 0;
  font-weight:bold
}
.tweet .user_name {
  margin-top: 4px;
  font-size:0.75em;
}
.tweet .user_name a { text-decoration: none; }
.tweet .user_name a:hover { text-decoration: underline; }
a.permalink { text-decoration: none; }
a.permalink:hover { background-color:#666666 }
.tweet .favorite_count {
  display: inline-block;
  margin-bottom: 0;
  font-size:0.75em;
}
.tweet .retweet_count {
  display: inline-block;
  margin-left: 16px;
  margin-bottom: 0;
  font-size:0.75em;
}
.tweet .created_at {
  margin-bottom: 0;
  font-size:0.75em;
}
.tweet .permalink {
  margin-left: 6px; 
}
.child {
  margin-top: 16px;
  margin-left: 64px;
  max-width: calc(600px - 64px);
  background-color: white;
}
.parent {
  margin-bottom: 16px;
  margin-right: 64px;
  max-width: calc(600px - 64px);
  background-color: white;
}
@media screen and (max-width: 599px) {
  .tweet li {
    height: 15vh;
    width: 15vh;
    flex-grow: 1;
  }
}
@media(prefers-color-scheme: dark) {
  body {
    background-color: black;
    color: white;
  }
  a {
    color: #33ff00;
    text-decoration: none;
  }
  a:hover {
    color: #33ff00;
    text-decoration: underline;
  }
  .tweet {
    background-color: black;
    border: 1px solid gray; /*#33ff00;*/
    border-radius: 5px;
  }
  .child {
    background-color: black;
  }
  .parent {
    background-color: black;
  }
  button {
    background-color: black;
    color: white;
  }
  input {
    background-color: black;
    color: white;
  }
  .tweet .favorite_count {
    color: #33ff00;
  }
  .tweet .retweet_count {
    color: #33ff00;
  }
  .tweet .created_at {
    color: #33ff00;
  }
}
#tabs {
  margin: -16px 0 0;
}
.tab:first-child {
  margin-left: -16px;
  border-top-left-radius: 16px;
}
.hr {
  margin: 0 -16px 16px -16px;
}
.tab {
  border: none;
  font-size: 1.2em;
  cursor: pointer;
  padding: 4px 10px;
  border-right: 2px solid black;
  box-sizing: border-box;
}
.tab.active {
  text-decoration: underline;
}
#browse-sort > button {
  font-size: 1.0em;
}
#page-num {
  font-size: 1.0em;
  width: 80px;
}
#browse-sort {
  line-height: 1.7em;
}
#paging {
  margin: 8px 0;
}`;
}

export function parseZip(files:string[], {callback:{fallback, starting, filtering, filteringPost, makingThreads, makingHtml, makingSearch, makingMedia, doneFailure, doneSuccess}, baseUrl, directoriesDisabled:_directoriesDisabled, inputDirectory, saveAs, saveAsDirectory, promisesMax}:{callback?:{fallback?:(string)=>void, starting?:(string)=>void, filtering?:(string)=>void, filteringPost?:(string)=>void, makingThreads?:(string)=>void, makingHtml?:(string)=>void, makingSearch?:(string)=>void, makingMedia?:(string)=>void, doneFailure?:(string)=>void, doneSuccess?:(string)=>void}, baseUrl?:string, directoriesDisabled?:boolean, inputDirectory?:boolean, saveAs?:string, saveAsDirectory?:boolean, promisesMax?:number}, config:{dir?:string, js_dir?:string, avatar?:string, name?:string, title?:string, introduction?:string, footer?:string, robots?:string, jsdelivr?:boolean, suppress_oldest?:boolean}) {
  assert(saveAs, "No save destination given");
  assert(config.dir != null, "Neither sample.toml nor a --config option file were found.")
  baseUrlOverride = baseUrl;
  if (_directoriesDisabled != null)
    directoriesDisabled = _directoriesDisabled;

  (starting || fallback)("Starting...");
  const dateBefore = new Date();
  function handleFile(f) {
    const zip = inputDirectory ? null : new AdmZip(f);
    const entries = zip && zip.getEntries();
    // We do not interact directly with zip, instead we use the entryFilter, readAsTextPromise, readPromise wrappers.
    // This (1) works around weirdness in the adm-zip api and (2) allows us to swap out adm-zip for regular node fs. 
    const entryFilter = zip ? // Notice some awkwardness with ambiguity of return types. Return maps (KEY) a tweet directory name to (VALUE) somewhere it can be looked up.
      (prefix:RegExp) => {
        let result = new Map<string, AdmZip.IZipEntry>();
        for (const entry of entries) {
          const path = entry.entryName;
          if (!entry.isDirectory && path.match(prefix)) {
            result.set(path.replace(prefix, ""), entry);
          }
        }
        return result;
      } :
      function entryFitlerImpl(prefix:RegExp, _matchPath?:string, _diskPath?:string, _result?:Map<string, string>) { // Recursively walk directory. (There is a "recursive" flag on readdirSync in node 20 or newer but this was written against 18)
        const result = _result || new Map<string, string>();
        const matchPath = _matchPath; // Partial path for RegExp match
        const diskPath = _diskPath || f; // Partial path for (VALUE)
        const contents = fsReaddirSync(diskPath, {'withFileTypes':true}); // "withFileTypes", misleadingly, tells you if it's a file or directory
        for (const dirent of contents) {
          const name = dirent.name;
          const match = matchPath ? `${matchPath}/${name}` : name;
          const path = pathJoin(diskPath, name);
          if (dirent.isDirectory()) {
            entryFitlerImpl(prefix, match, path, result); // Recurse, keep searching
          } else if (match.match(prefix)) { // Directory is a match; don't look any deeper.
            result.set(name, path);
          }
        }
        return result;
      };
      function safePathJoin(a,b) { // Cannot believe Node doesn't do this automatically
        if (pathIsAbsolute(b)) {
          return b;
        } else {
          return pathJoin(a,b);
        }
      }

    try {
        const dateAfter = new Date();
        const admPromisify1 = (f) => promisify((a1,callback) => f(a1, (x,y) => callback(y,x))); // This is AWFUL: AdmZip does its callback args in opposite order from Node
        const readAsTextPromise = zip ?
          admPromisify1((x:string,y) => zip.readAsTextAsync(zip.getEntry(x),y,"utf8")) :
          (x:string) => fsExtra.readFile(safePathJoin(f, x)).then((y:Buffer)=>y.toString());
        const readPromise = zip ?
          admPromisify1(zip.readFileAsync) as (arg1: string | AdmZip.IZipEntry) => Promise<Buffer> :
          (x:string) => fsExtra.readFile(safePathJoin(f, x));
        function pushIf<T>(ary:T[], value:T|null) {
          if (value != null) {
            ary.push(value);
          }
        }
        readAsTextPromise('data/manifest.js').then(function(content) {
          if (typeof window == "undefined") {
            globalThis.window = {YTD:{tweet:{}}};
            globalThis.window.YTD.tweets = globalThis.window.YTD.tweet;
          }

          eval(content as string); // Oh no
          const tweetFiles = typeof window.__THAR_CONFIG.dataTypes.tweets == "undefined" ?
            window.__THAR_CONFIG.dataTypes.tweet.files :
            window.__THAR_CONFIG.dataTypes.tweets.files;
          const userName = window.__THAR_CONFIG.userInfo.userName;
          const displayName = config.name || window.__THAR_CONFIG.userInfo.displayName;
          const accountId = window.__THAR_CONFIG.userInfo.accountId;
          const siteAvatarPath = `${userName}/avatar/${pathBasename(config.avatar)}`;
          const accountInfo = {
            userName, displayName, accountId,
            avatarPath:siteAvatarPath, introduction:config.introduction, title:config.title, footer:config.footer,
            suppressOldest: config.suppress_oldest,
          };
          // set up for grabbing all the tweet data
          let promises = [];
          for (const file of tweetFiles) {
            promises.push(new Promise((resolve, reject) => {
              readAsTextPromise(file.fileName).then(tweetContent => {
                eval(tweetContent as string); // Oh no no no
                resolve(`done ${file.fileName}`);
              }).catch(reject);
            }));
          }
          // grab all the tweet data
          Promise.all(promises).then(async (values) => {
            // when done...
            let sitePromises = [];
            const siteZip = saveAsDirectory ? null : new AdmZip();
            function saveFile(path:string, content:Buffer|string) {
              if (saveAsDirectory) {
                const diskPath = pathJoin(saveAs, path);
                return fsMkdir(pathDirname(diskPath), {'recursive':true}).then(() =>
                  fsWriteFile(diskPath, content) // Async; just assume it completes.
                );
              } else {
                const contentBuffer = content instanceof Buffer ? content : Buffer.from(content);
                siteZip.addFile(path, contentBuffer);
                return null
              }
            }
            // A note about async.
            // This program was originally written directly using the Promise API.
            // But then when it was ported to Node, it turned out queueing thousands of I/O ops leads to a "too many files open" error.
            // To fix this, I switched to fs-extra, which fixed the problem for medium-size loads. But not large ones.
            // So I introduced this function that doesn't allow more than 100 inflight promises at once and waits when that's exceeded.
            // Now we're using async in one place. So it would make sense to convert everything *else* to use async as well. But this has not happened yet.
            async function pushPromise(promise) {
              if (promisesMax && sitePromises.length > promisesMax) {
                const batchPromises = sitePromises;
                sitePromises = [];
                await Promise.all(batchPromises);
              }
              pushIf(sitePromises, promise);
            }
            await pushPromise(saveFile(`styles.css`, makeStyles()));
            // Copy user-specified avatar file (from real hard drive)
            await pushPromise(fsExtra.readFile(config.avatar).then(buffer => saveFile(siteAvatarPath, buffer)));
            if (config.robots) {
              await pushPromise(fsExtra.readFile(config.robots).then(buffer => saveFile(`robots.txt`, buffer)));
            }
            if (!config.jsdelivr) {
              await pushPromise(fsExtra.readFile(pathJoin(config.js_dir, "flexsearch.bundle.js")).then(buffer => saveFile(`flexsearch.bundle.js`, buffer)));
            }
            // flatten the arrays of tweets into one big array
            tweets = [];
            (filtering || fallback)("Filtering and flattening tweets...");
            const windowTweets = typeof window.YTD.tweets == "undefined" ? window.YTD.tweet : window.YTD.tweets;
            for (const wrapper of Object.keys(windowTweets)) {
              for (const data of windowTweets[wrapper]) {
                const tweet = data.tweet;
                // only save tweets that are original tweets or replies to myself
                if (!tweet.in_reply_to_user_id_str || tweet.in_reply_to_user_id_str === accountId.toString()) {
                  tweets.push(tweet);
                }
              }
            }
            (filteringPost || fallback)(`${tweets.length} tweets.`);
            (makingThreads || fallback)("Setting up threading metadata...");
            // iterate once through every tweet to set up the children array
            // so if something I wrote has two direct replies that I wrote, it will have an array size 2 with each ID of the two child replies
            for (const tweet of tweets) {
              if (tweet.in_reply_to_user_id_str === accountId.toString()) {
                // find the original tweet in the data structure
                const parentIndex = tweets.findIndex(item => item.id_str === tweet.in_reply_to_status_id_str);
                if (parentIndex >= 0) { 
                  if (!tweets[parentIndex].children) {
                    tweets[parentIndex].children = [tweet.id_str];
                  } else {
                    tweets[parentIndex].children.push(tweet.id_str);
                  }
                }
              }
            }
            (makingHtml || fallback)("Making all the HTML pages...");
            for (const tweet of tweets) {
                let id = tweet.id_str || tweet.id;
                if (directoriesDisabled) {
                  await pushPromise(saveFile(`${userName}/status/${id}.html`, makePage(tweet, accountInfo)));
                } else {
                  await pushPromise(saveFile(`${userName}/status/${id}/index.html`, makePage(tweet, accountInfo)));
                }
            }
            (makingSearch || fallback)("Making the search/browse index...");
            const searchDocuments = tweets
              .filter(tweet => tweet.full_text.substr(0,4) !== 'RT @')
              .filter(tweet => tweet.full_text.substr(0,1) !== '@')
              .map(tweet => {
                  return {
                    created_at: tweet.created_at,
                    id_str: tweet.id_str,
                    full_text: tweet.full_text,
                    favorite_count: tweet.favorite_count,
                    retweet_count: tweet.retweet_count,
                    ...tweet.in_reply_to_user_id_str && {is_reply: true}
                  };
                });
            await pushPromise(saveFile(`searchDocuments.js`, 'const searchDocuments = ' + JSON.stringify(searchDocuments)));
            await pushPromise(saveFile(`app.js`, makeOutputAppJs(accountInfo)));
            await pushPromise(saveFile(`index.html`, makeOutputIndexHtml(accountInfo, config.jsdelivr)));
            (makingMedia || fallback)("Dropping in all your media files...");
            for (const [relativePath, file] of entryFilter(/^data\/tweets?_media\//).entries()) { // TODO test this
              // only include this in the archive if it's original material we posted (not RTs)
              // grab the tweet id from the filename
              const matchId = relativePath.match(/^(.+?)-/);
              const tweetId = matchId ? matchId[1] : '';
              if (tweetId) {
                const tweet = tweets.find(tweet => tweet.id_str === tweetId);
                if (tweet
                    && tweet.extended_entities
                    && tweet.extended_entities.media
                    && tweet.extended_entities.media.length > 0) {
                  // if this tweet has media and it's original material (not from a retweet), add it to the zip
                  if (!tweet.extended_entities.media[0].source_user_id_str || tweet.extended_entities.media[0].source_user_id_str === accountInfo.accountId.toString()) {
                    const nextPromise = readPromise(file).then(buffer => saveFile(`${userName}/tweets_media/${relativePath}`, buffer));
                    await pushPromise(nextPromise);
                  }
                }
              }
            };
            let okayDone = () => { // FIXME: Would be nice to wait on some of the promises above.
              console.log('DONE');
              (doneSuccess || fallback)(`<strong>DONE!!!</strong> Check your browser downloads for "archive.zip", and then unzip it on a web server somewhere. <em>It is likely to be much smaller than your original zip because it won't have media for stuff you retweeted.</em> I highly recommend that you upload the zip file itself to the server and unzip it once it's there. That way your file transfer will go much faster than if you try to unzip it localy and then upload 100k files. If you are using something like cPanel on your host, I believe most versions of that let you unzip a file you've uploaded somewhere in the user interface.`);
            }
            console.log("Awaiting promises");
            await Promise.all(sitePromises).then(() => {
              if (!saveAsDirectory) {
                siteZip.writeZip(saveAs);
              }
            }).then(okayDone).catch(standardError(1));
          }).catch(standardError(2));
        }).catch(standardError(3));
      } catch(error) {
        standardError(4)(error);
      }
  }
  var standardError = (site) => (error) => {
    (doneFailure || fallback)(`At site ${site}, stack ${error.stack}:\n${error.toString()}`);
    if (error.toString().includes('TypeError')) {
      (doneFailure || fallback)(`I am guessing that your zip file is missing some files. It is also possible that you unzipped and re-zipped your file and the data is in an extra subdirectory. Check out the "Known problems" section above. You'll need the "data" directory to be in the zip root, not living under some other directory.`);
    }
    if (error.toString().includes('Corrupted')) {
      (doneFailure || fallback)(`I am guessing that your archive is too big! If it's more than 2GB you're likely to see this error. If you look above at the "Known problems" section, you'll see a potential solution. Sorry it is a bit of a pain in the ass.`);
    }
  };
  assert.equal(files.length, 1, "Currently only single-file-at-once supported"); // TODO Does multiple-in out to one output or what? What is the intent
  for (const file of files) {
    handleFile(file);
  }
}

// Note: No longer used
function parseZipHtml() {
  let $output = document.getElementById('output');
  let fallback = (msg) => {
    $output.innerHTML += `<p>${msg}</p>`;
    document.querySelectorAll('body')[0].scrollIntoView(false);
  }
  let starting = (msg) => {
    console.log('starting...');
    document.getElementById('loading').hidden = false;
    fallback(msg);
  }
  let doneFailure = (msg) => {
    $output.innerHTML += `<p class="error">Error! ${msg}</p>`;
    document.getElementById('loading').hidden = true;
    document.querySelectorAll('body')[0].scrollIntoView(false);
  }
  parseZip(document.getElementById('file').files, {callback:{starting, fallback, doneFailure}}, {});
}

function makeOutputAppJs(accountInfo) {
  const outputAppJs = `
let results;

var index = new FlexSearch.Document({
	encode: function(str){
		const cjkItems = str.replace(/[\\x00-\\x7F]/g, "").split("");
		const asciiItems = str.toLowerCase().split(/\\W+/);
		return cjkItems.concat(asciiItems);
  },
  document: {
    id: "id_str",
    index: ["full_text"],
    store: true
  }
});


const searchInput = document.getElementById('search-input');

function processData(data) {
  for (doc of data) {
    index.add({
        id_str: doc.id_str,
        created_at: doc.created_at,
        full_text: doc.full_text,
        favorite_count: doc.favorite_count,
        retweet_count: doc.retweet_count,
        is_reply: doc.is_reply
    })
  };
  document.getElementById('loading').hidden = true;
  document.getElementById('search').hidden = false;
}

processData(searchDocuments);
let browseDocuments = searchDocuments.sort(function(a,b){
  return new Date(b.created_at) - new Date(a.created_at);
});

function sortResults(criterion) {
  if (criterion === 'newest-first') {
    results = results.sort(function(a,b){
      return new Date(b.created_at) - new Date(a.created_at);
    });
    renderResults();
  }
  if (criterion === 'oldest-first') {
    results = results.sort(function(a,b){
      return new Date(a.created_at) - new Date(b.created_at);
    });
    renderResults();
  }
  if (criterion === 'most-relevant') {
    results = results.sort(function(a,b){
      return a.index - b.index;
    });
    renderResults();
  }
  if (criterion === 'most-popular') {
    results = results.sort(function(a,b){
      return (+b.favorite_count + +b.retweet_count) - (+a.favorite_count + +a.retweet_count);
    });
    renderResults();
  }
  if (criterion === 'newest-first-browse') {
    browseDocuments = browseDocuments.sort(function(a,b){
      return new Date(b.created_at) - new Date(a.created_at);
    });
    renderBrowse();
  }
  if (criterion === 'oldest-first-browse') {
    browseDocuments = browseDocuments.sort(function(a,b){
      return new Date(a.created_at) - new Date(b.created_at);
    });
    renderBrowse();
  }
  if (criterion === 'most-popular-browse') {
    browseDocuments = browseDocuments.sort(function(a,b){
      return (+b.favorite_count + +b.retweet_count) - (+a.favorite_count + +a.retweet_count);
    });
    renderBrowse();
  }
}

function renderResults() {
  const output = results.map(item => \`<p class="search_item"><div class="search_text">\${item.full_text}</div><div class="search_time">\${new Date(item.created_at).toLocaleString()} <div class="search_link"><a class="permalink" href="${accountInfo.userName}/status/\${item.id_str}">🔗</a>\${item.is_reply?'<div class="reply_badge">(reply)</div>':""}</div></div><hr class="search_divider" /></p>\`.replace(/\\.\\.\\/\\.\\.\\/tweets_media\\//g,'${accountInfo.userName}/tweets_media/'));
  document.getElementById('output').innerHTML = output.join('');
  if (results.length > 0) {
    document.getElementById('output').innerHTML += '<a href="#tabs">top &uarr;</a>';
  }
}

function onSearchChange(e) {
  results = index.search(e.target.value, { enrich: true });
  if (results.length > 0) {
    // limit search results to the top 100 by relevance
    results = results.slice(0,100);
    // preserve original search result order in the 'index' variable since that is ordered by relevance
    results = results[0].result.map((item, index) => { let result = item.doc; result.index = index; return result;});
  }
  renderResults();
}
searchInput.addEventListener('input', onSearchChange);

function searchTab() {
  const clickedTab = document.getElementById('search-tab');
  clickedTab.classList.add('active');
  const otherTab = document.getElementById('browse-tab');
  otherTab.classList.remove('active');
  document.getElementById('browse').hidden = true;
  document.getElementById('search').hidden = false;
}

function browseTab() {
  const clickedTab = document.getElementById('browse-tab');
  clickedTab.classList.add('active');
  const otherTab = document.getElementById('search-tab');
  otherTab.classList.remove('active');
  const searchContent = document.getElementById('search');
  document.getElementById('search').hidden = true;
  document.getElementById('browse').hidden = false;
}

const pageSize = 50;
const pageMax = Math.floor(browseDocuments.length/pageSize) + 1;
let page = 1;
let browseIndex = (page - 1) * pageSize;

function onPageNumChange(e) {
  page = e.target.value;
  browseIndex = (page - 1) * pageSize;
  renderBrowse();
}

document.getElementById('page-total').innerText = pageMax;
document.getElementById('page-num').addEventListener('input', onPageNumChange);
document.getElementById('page-num').value = +page;
document.getElementById('page-num').max = pageMax;
document.getElementById('page-num').min = 1;

function renderBrowse() {
  const output = browseDocuments.slice(browseIndex, browseIndex + pageSize).map(item => \`<p class="search_item"><!-- Avatar here --><div class="search_text">\${item.full_text}</div><div class="search_link"><div class="search_time">\${new Date(item.created_at).toLocaleString()} <a class="permalink" href="${accountInfo.userName}/status/\${item.id_str}">🔗</a>\${item.is_reply?'<div class="reply_badge">(reply)</div>':""}</div></div><hr class="search_divider" /></p>\`.replace(/\\.\\.\\/\\.\\.\\/tweets_media\\//g,'${accountInfo.userName}/tweets_media/'));
  document.getElementById('browse-output').innerHTML = output.join('');
  document.getElementById('browse-output').innerHTML += '<a href="#tabs">top &uarr;</a>';
}

renderBrowse();`;
  return outputAppJs;
}

function makeOutputIndexHtml(accountInfo, jsdelivr) {
  const generatedDate = new Date().toUTCString();
  const title = accountInfo.title || `Welcome to the @${accountInfo.userName} Twitter archive`;
  const oldestSnippetSearch = accountInfo.suppressOldest ? "" : `<button class="sort-button" onclick="sortResults('oldest-first')">oldest first</button> | `;
  const oldestSnippetBrowse = accountInfo.suppressOldest ? "" : `<button class="sort-button-browse" onclick="sortResults('oldest-first-browse')">oldest first</button> | `;
  const flexsearchPath = jsdelivr ? "https://cdn.jsdelivr.net/gh/nextapps-de/flexsearch@0.7.31/dist/flexsearch.bundle.js" : "flexsearch.bundle.js"
  const outputIndexHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>@${accountInfo.userName} Twitter archive</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div class="wrapper">
    <div class="flex-wrap">
      <div class="flex-cols">
        <img width="128" height="128" style="margin-right:2em" src="${accountInfo.avatarPath}" />
        <h1>${title}</h1>
      </div>
      <p>${accountInfo.introduction}</p>
      <!-- Generated ${generatedDate} -->
      <div class="tweet">
        <p id="tabs">
          <button class="tab active" id="search-tab" onclick="searchTab()">Search</button><button class="tab" id="browse-tab" onclick="browseTab()">Browse</button>
        </p>
        <hr class="hr">
        <p id="loading">Loading search...</p>
        <div id="search" hidden>
          <input id="search-input" type="search" />
          <div id="sorting">Sort by: <button class="sort-button" onclick="sortResults('most-relevant')">most relevant</button> | ${oldestSnippetSearch}<button class="sort-button" onclick="sortResults('newest-first')">newest first</button> | <button class="sort-button" onclick="sortResults('most-popular')">most popular</button></div>
          <div id="output"></div>
        </div>
        <div id="browse" hidden>
          <div id="browse-sort">Sort by: ${oldestSnippetBrowse}<button class="sort-button-browse" onclick="sortResults('newest-first-browse')">newest first</button> | <button class="sort-button" onclick="sortResults('most-popular-browse')">most popular</button></div>
          <p id="paging">Page <input id="page-num" type="number" /> of <span id="page-total">...</span> </p>
          <div id="browse-output"></div>
        </div>
      </div>
      <p>This site was made with <a href="https://tinysubversions.com/twitter-archive/make-your-own/">this Twitter archiving tool</a> (via <a href="https://github.com/mcclure/twitter-archiver/tree/cmdline-only">this</a> fork).${accountInfo.footer||""}</p>
    </div>
  </div>
</body>
<script src="searchDocuments.js"></script>
<script src="${flexsearchPath}"></script>
<script src="app.js"></script>
</html>`;
  return outputIndexHtml;
}
