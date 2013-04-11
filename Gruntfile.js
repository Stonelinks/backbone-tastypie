// this Gruntfile will probably be useful for nobody

module.exports = function(grunt) {
  'use strict';

  // Dependencies
  // ------------
  
  grunt.loadNpmTasks('grunt-regarde');
  grunt.loadNpmTasks('grunt-exec');

  // Config
  // ------
  
  var SRC = 'backbone_tastypie/';
  var DST = '../mujin/dev/mujinjsclient/mujincontroller/app/vendor/backbone-tastypie/';
  
  grunt.initConfig({
    exec: {
      fixjsstyle: {
        command: 'fixjsstyle -r backbone_tastypie/static/js/backbone_tastypie.js',
        stdout: true
      },
      copy: {
        command: function() {
          var cmds = [];
          cmds.push('cp -r ' + SRC + ' ' + DST);
          return cmds.join(' && ');
        },
        stdout: true
      }
    },
    regarde: {
      js: {
        files: SRC + '**/*',
        tasks: ['exec:fixjsstyle', 'exec:copy']
      }
    }
  });

  // Tasks
  // -----

  // handy watch to copy js to where i need it
  grunt.registerTask('watch', ['regarde']);
};
