var request = require('request');
var cheerio = require('cheerio');
var url = require('url');

/*
 * Scrap Google. Usage example:
 * var options = {
 *   query: 'site:forbes.com nvidia',
 *   host: 'www.google.com',
 *   lang: 'us',
 *   range: {
 *     min: '3-8-2017',
 *     max: '3-8-2017'
 *   },
 *   sortBy: "date",
 *   limit: 5
 * };
 * 
 * search(options, callback);
 */
function search(options, callback) {

  var session = request.defaults({ jar: true });
  var host = options.host || 'www.google.com';
  var solver = options.solver;
  var params = options.params || {};
  var results = [];

  params.hl = params.hl || options.lang || 'en';

  if (options.age) params.tbs = 'qdr:' + options.age;
  if (options.range) params.tbs = 'cdr:1,cd_min:' + options.range.min + ',cd_max:' + options.range.max;
  if (options.query) params.q = options.query;
  if (options.sortBy) params.tbs = params.tbs + ',sbd:' + (options.sortBy === 'date' ? 1 : 0);

  params.start = params.start || 0;

  getPage(params, function onPage(err, body) {
    if (err) {
      if (err.code !== 'ECAPTCHA' || !solver) return callback(err);

      solveCaptcha(err.location, function (err, page) {
        if (err) return callback(err);
        onPage(null, page);
      });

      return;
    }

    var currentResults = extractResults(body);
    var newResults = currentResults.filter(function (result) {
      return results.indexOf(result) === -1;
    });

    if (newResults.length > 0) {
      callback(null, newResults);
    }

    if (newResults.length === 0) {
      return;
    }

    results = results.concat(newResults);

    if (!options.limit || results.length < options.limit) {
      params.start = results.length;
      getPage(params, onPage);
    }
  });


  function getPage(params, callback) {

    session.get({
      uri: 'http://' + host + '/search',
      qs: params,
      followRedirect: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/63.0.3239.132 Safari/537.36'
      }
    },
      function (err, res) {
        if (err) return callback(err);
        if (res.statusCode === 302) {
          var parsed = url.parse(res.headers.location, true);
          if (parsed.pathname !== '/search') {
            var err = new Error('Captcha');
            err.code = 'ECAPTCHA';
            err.location = res.headers.location;
            this.abort();
            return callback(err);
          } else {
            session.get({
              uri: res.headers.location,
              qs: params,
              followRedirect: false
            }, function (err, res) {
              if (err) return callback(err);
              callback(null, res.body);
            });
            return;
          }
        }

        callback(null, res.body);
      }
    );
  }

  function extractResults(body) {
    var results = [];
    var $ = cheerio.load(body);

    $('.g h3 a').each(function (i, elem) {
      var parsed = url.parse(elem.attribs.href, true);
      if (parsed.href) {
        results.push(parsed.href);
      }
    });

    return results;
  }

  function solveCaptcha(captchaUrl, callback) {

    var tmp = url.parse(captchaUrl);
    var baseUrl = url.format({
      protocol: tmp.protocol,
      hostname: tmp.host,
    });

    // Fetch captcha page
    session.get(captchaUrl, function (err, res) {
      if (err) return callback(err);

      var $ = cheerio.load(res.body);
      var captchaId = $('input[name=id]').attr('value');
      var continueUrl = $('input[name=continue]').attr('value');
      var formAction = $('form').attr('action');
      var imgSrc = $('img').attr('src');

      // Fetch captcha image
      session.get({ uri: baseUrl + imgSrc, encoding: null }, function (err, res) {
        if (err) return callback(err);

        // Send to solver
        solver.solve(res.body, function (err, id, solution) {
          if (err) return callback(err);

          // Try solution
          session.get({
            uri: baseUrl + '/sorry/' + formAction,
            qs: {
              id: captchaId,
              captcha: solution,
              continue: continueUrl
            }
          },
            function (err, res) {
              if (res.statusCode !== 200) return callback(new Error('Captcha decoding failed'));
              callback(null, res.body);
            }
          );

        });

      });

    });

  }

}

module.exports.search = search;