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
(function (root, factory) {
    // https://github.com/umdjs/umd/blob/master/returnExports.js
    if (typeof exports === 'object') {
        // Node
        module.exports = factory(require('backbone'), require('underscore'), require('URI'));
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['backbone', 'underscore', 'URI'], factory);
    } else {
        // Browser globals (root is window)
        root.Backbone = factory(root.Backbone, root._, root.URI);
    }
}(this, function (Backbone, _, URI) {
  "use strict";

  //~ change this to true to enable debug messages
  var DEBUG = true;
  var debug = function(msg) {
    if (DEBUG) {
      print(msg)
    }
  }

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

    //~ handle fields
    if (options.hasOwnProperty('fields')) {
      if (model.hasOwnProperty('_fields')) {
        print('WARNING: overwriting fields in model ' + model.id + ': ' + model._fields.join(','))
        print('so this is usually a bad thing, and might be because two requests with different field parameters are happening at the same time for this model or collection.')
      }
      model._fields = _.isArray(options.fields) ? options.fields : [options.fields];
    }

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
    
    var complete = options.complete;
    options.complete = function(xhr, textStatus, errorText) {
      
      //~ clear fields if they were being used
      if (model.hasOwnProperty('_fields')) {
        debug('delete fields ' + model._fields + ' for model ' + model.id)
        delete model._fields
        debug('model ' + model.id + ' fields are ' + model._fields)
      }
      
      //~ call original complete function
      if (_.isFunction(complete)) {
        complete(xhr, textStatus, errorText)
      }
    }
    
    //~ print error messages that come back from the API
    var error = options.error;
    options.error = function(xhr, textStatus, errorThrown) {
      if (xhr.hasOwnProperty('responseText')) {
        if (isJSON(xhr.responseText) && xhr.responseText != '') {
          var errorData = $.parseJSON(xhr.responseText);
          if (errorData.hasOwnProperty('error_message')) {
            print('Error message: ' + errorData.error_message);
          }

          if (errorData.hasOwnProperty('traceback')) {
            print(errorData.traceback);
          }
        }
      }
      else {
        print('Error message: ' + xhr.responseText);
      }
      
      //~ call original error function
      if (_.isFunction(error)) {
        error(xhr, textStatus, errorThrown);
      }
    }
    
    return Backbone.oldSync(method, model, options);
  };

  Backbone.Model.prototype.idAttribute = 'pk';

  //~ add fields to querystring of url
  var addFields = function(url, fields) {

    //~ make sure pk is always in fields
    if (_.indexOf(fields, 'pk') == -1) {
      fields.push('pk');
    }

    var ret = URI(url).setQuery('fields', fields.join(',')).href();
    debug('fields added to url, here\'s the result: ' + ret);
    return ret;
  }

  Backbone.Model.prototype.url = function() {
    var url;
    
    url = _.result(this, 'urlRoot')
    url = url || this.collection && (_.result(this.collection, 'url'));

    if (url && this.hasOwnProperty('id')) {
      url = addSlash(url) + this.id;
    }
    url = addSlash(url);
    
    //~ add any fields that need to be in the url
    if (url && this.hasOwnProperty('_fields')) {
      url = addFields(url, this._fields)
    }
    
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
    
    //~ add any fields that need to be in the url
    if (url && this.hasOwnProperty('_fields')) {
      url = addFields(url, this._fields)
    }

    return url || null;
  };

  var addSlash = function(str) {
    return str + ((str.length > 0 && str.charAt(str.length - 1) === '/') ? '' : '/');
  };
  
  return Backbone;
}));
