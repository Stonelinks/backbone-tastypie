/**
 * Backbone-tastypie.js 0.2
 * (c) 2011 Paul Uithol
 *
 * Backbone-tastypie may be freely distributed under the MIT license.
 * Add or override Backbone.js functionality, for compatibility with django-tastypie.
 * Depends on Backbone (and thus on Underscore as well): https://github.com/documentcloud/backbone.
 *
 * Modifications to work with a highly customized version of Tastypie by Lucas Doyle 2013
 *
 */
(function(root, factory) {
    // https://github.com/umdjs/umd/blob/master/returnExports.js
    if (typeof exports === 'object') {
        // Node
        module.exports = factory(require('backbone'), require('underscore'), require('URI'));
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['backbone', 'underscore', 'URI', 'vent'], factory);
    } else {
        // Browser globals (root is window)
        root.Backbone = factory(root.Backbone, root._, root.URI);
    }
}(this, function(Backbone, _, URI, vent) {
  'use strict';

  //~ change this to true to enable debug messages
  var DEBUG = true;
  var debug = function(msg) {
    if (DEBUG) {
      print(msg);
    }
  };

  Backbone.Tastypie = {
    doGetOnEmptyPostResponse: true,
    doGetOnEmptyPutResponse: false,
    apiKey: {
      username: '',
      key: ''
    },
    csrfToken: ''
  };

  /**
   * Override Backbone's sync function, to do a GET upon receiving a HTTP CREATED.
   * This requires 2 requests to do a create, so you may want to use some other method in production.
   * Modified from http://joshbohde.com/blog/backbonejs-and-django
   */
  Backbone.oldSync = Backbone.sync;
  Backbone.sync = function(method, model, options) {
    var headers = {};

    if (Backbone.Tastypie.apiKey && Backbone.Tastypie.apiKey.username) {
      headers['Authorization'] = 'ApiKey ' + Backbone.Tastypie.apiKey.username + ':' + Backbone.Tastypie.apiKey.key;
    }

    if (Backbone.Tastypie.csrfToken) {
      headers['X-CSRFToken'] = Backbone.Tastypie.csrfToken;
    }

    // Keep `headers` for a potential second request
    headers = _.extend(headers, options.headers);
    options.headers = headers;

    if ((method === 'create' && Backbone.Tastypie.doGetOnEmptyPostResponse) ||
      (method === 'update' && Backbone.Tastypie.doGetOnEmptyPutResponse)) {
      var dfd = new $.Deferred();

      // Set up 'success' handling
      var success = options.success;
      dfd.done(function(resp, textStatus, xhr) {
        _.isFunction(success) && success(resp);
      });

      options.success = function(resp, textStatus, xhr) {
        // If create is successful but doesn't return a response, fire an extra GET.
        // Otherwise, resolve the deferred (which triggers the original 'success' callbacks).
        if (!resp && (xhr.status === 201 || xhr.status === 202 || xhr.status === 204)) { // 201 CREATED, 202 ACCEPTED or 204 NO CONTENT; response null or empty.
          var location = xhr.getResponseHeader('Location') || model.id;
          return Backbone.ajax({
            url: location,
            headers: headers,
            success: dfd.resolve,
            error: dfd.reject
          });
        }
        else {
          return dfd.resolveWith(options.context || options, [resp, textStatus, xhr]);
        }
      };

      // Set up 'error' handling
      var error = options.error;
      dfd.fail(function(xhr, textStatus, errorThrown) {
        _.isFunction(error) && error(xhr.responseText);
      });

      options.error = function(xhr, textStatus, errorText) {
        dfd.rejectWith(options.context || options, [xhr, textStatus, xhr.responseText]);
      };

      // Create the request, and make it accessibly by assigning it to the 'request' property on the deferred
      dfd.request = Backbone.oldSync(method, model, options);
      return dfd;
    }

    //~ print error messages that come back from the API
    var error = options.error;
    options.error = function(xhr, textStatus, errorThrown) {
      
      vent.trigger('api:error', xhr, this, textStatus, errorThrown);

      //~ call original error function
      if (_.isFunction(error)) {
        error(xhr, textStatus, errorThrown);
      }
    };

    //~ HERE BEGINS A MODIFIED COPY OF THE ORIGINAL BACKBONE SYNC FUNCTION
    //~    write changes you make to it here:
    //~      - added fields support to output of url function
    //~      - changed patch requests from http method PATCH to PUT

    // Map from CRUD to HTTP for our default `Backbone.sync` implementation.
    var methodMap = {
      'create': 'POST',
      'update': 'PUT',
      'patch': 'PUT',
      'delete': 'DELETE',
      'read': 'GET'
    };

    var type = methodMap[method];

    // Default options, unless specified.
    _.defaults(options || (options = {}), {
      emulateHTTP: Backbone.emulateHTTP,
      emulateJSON: Backbone.emulateJSON
    });

    // Default JSON-request options.
    var params = {type: type, dataType: 'json'};

    // Ensure that we have a URL.
    var url = options.url;
    if (!url) {
      params.url = _.result(model, 'url') || urlError();
      url = params.url;
    }

    var _uri = URI(url);

    //~ add fields to url
    if (options.hasOwnProperty('fields')) {
      var fields = _.isArray(options.fields) ? options.fields : [options.fields];

      //~ make sure pk is always in fields
      if (!_.contains(fields, 'pk')) {
        fields.push('pk');
      }

      _uri.setQuery('fields', fields.join(','));
    }

    // default url parameters
    var defaults = {
      limit: 0,
      format: 'json'
    };
    // var keyAlias = {
      // order_by: 'orderBy'
    // };

    _.forEach(defaults, function(value, key) {
      if (options.hasOwnProperty(key)) {
        _uri.setQuery(key, options[key]);
      }
      // else if (options.hasOwnProperty(keyAlias[key])) {
        // _uri.setQuery(key, options[keyAlias[key]]);
      // }
      else {
        _uri.setQuery(key, value);
      }
    });

    // support arbitrary url parameters
    if (options.hasOwnProperty('urlParams') && _.isObject(options.urlParams)) {
      var urlParams = options.urlParams;

      _uri.setQuery(urlParams);
    }

    params.url = _uri.href();

    // Ensure that we have the appropriate request data.
    if (options.data == null && model && (method === 'create' || method === 'update' || method === 'patch')) {
      params.contentType = 'application/json';
      params.data = JSON.stringify(options.attrs || model.toJSON(options));
    }

    // For older servers, emulate JSON by encoding the request into an HTML-form.
    if (options.emulateJSON) {
      params.contentType = 'application/x-www-form-urlencoded';
      params.data = params.data ? {model: params.data} : {};
    }

    // For older servers, emulate HTTP by mimicking the HTTP method with `_method`
    // And an `X-HTTP-Method-Override` header.
    if (options.emulateHTTP && (type === 'PUT' || type === 'DELETE' || type === 'PATCH')) {
      params.type = 'POST';
      if (options.emulateJSON) params.data._method = type;
      var beforeSend = options.beforeSend;
      options.beforeSend = function(xhr) {
        xhr.setRequestHeader('X-HTTP-Method-Override', type);
        if (beforeSend) return beforeSend.apply(this, arguments);
      };
    }

    // Don't process data on a non-GET request.
    if (params.type !== 'GET' && !options.emulateJSON) {
      params.processData = false;
    }

    // If we're sending a `PATCH` request, and we're in an old Internet Explorer
    // that still has ActiveX enabled by default, override jQuery to use that
    // for XHR instead. Remove this line when jQuery supports `PATCH` on IE8.
    if (params.type === 'PATCH' && window.ActiveXObject &&
          !(window.external && window.external.msActiveXFilteringEnabled)) {
      params.xhr = function() {
        return new ActiveXObject('Microsoft.XMLHTTP');
      };
    }

    // Make the request, allowing the user to override any Ajax options.
    var xhr = options.xhr = Backbone.ajax(_.extend(params, options));
    model.trigger('request', model, xhr, options);
    return xhr;
  };

  Backbone.Model.prototype.idAttribute = 'pk';

  Backbone.Model.prototype.url = function() {
    var url;

    url = _.result(this, 'urlRoot');
    url = url || this.collection && (_.result(this.collection, 'url'));

    if (url && this.hasOwnProperty('id')) {
      url = addSlash(url) + this.id;
    }
    url = addSlash(url);

    return url || null;
  };

  /**
   * Return the first entry in 'data.objects' if it exists and is an array, or else just plain 'data'.
   */
  Backbone.Model.prototype.parse = function(data) {
    return data && data.objects && (_.isArray(data.objects) ? data.objects[0] : data.objects) || data;
  };

  /**
   * Return 'data.objects' if it exists.
   * If present, the 'data.meta' object is assigned to the 'collection.meta' var.
   */
  Backbone.Collection.prototype.parse = function(data) {
    if (data && data.meta) {
      this.meta = data.meta;
    }

    return data && data.objects || data;
  };

  Backbone.Collection.prototype.url = function(models) {
    var url = _.result(this, 'urlRoot');
    // If the collection doesn't specify an url, try to obtain one from a model in the collection
    if (!url) {
      var model = models && models.length && models[0];
      url = model && (_.result(model, 'urlRoot'));
    }
    url = url && addSlash(url);

    // Build a url to retrieve a set of models. This assume the last part of each model's idAttribute
    // (set to 'resource_uri') contains the model's id.
    if (models && models.length) {
      var ids = _.map(models, function(model) {
        var parts = _.compact(model.id.split('/'));
        return parts[parts.length - 1];
      });
      url += 'set/' + ids.join(';') + '/';
    }

    return url || null;
  };

  var addSlash = function(str) {
    return str + ((str.length > 0 && str.charAt(str.length - 1) === '/') ? '' : '/');
  };

  return Backbone;
}));
